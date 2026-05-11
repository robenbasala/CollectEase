/*
  Adds CompanyId to dbo.Portfolios and dbo.Properties, backfills from Regions / Portfolios,
  and fixes dbo.Regions rows where CompanyId is still NULL (assigns Montium).
  Run once after migrate-multitenant-companies.sql if those tables already existed without CompanyId.
*/

SET NOCOUNT ON;

DECLARE @MontiumId INT;
SELECT @MontiumId = Id FROM dbo.Companies WHERE Name = N'Montium';

IF @MontiumId IS NULL
BEGIN
  RAISERROR(N'Company Montium not found. Insert dbo.Companies first.', 16, 1);
  RETURN;
END

/* Regions: any NULL CompanyId */
UPDATE dbo.Regions SET CompanyId = @MontiumId WHERE CompanyId IS NULL;

/* -------- Portfolios -------- */
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Portfolios') AND name = N'CompanyId'
)
BEGIN
  ALTER TABLE dbo.Portfolios ADD CompanyId INT NULL;
END
GO

DECLARE @MontiumId2 INT;
SELECT @MontiumId2 = Id FROM dbo.Companies WHERE Name = N'Montium';

UPDATE p
SET p.CompanyId = r.CompanyId
FROM dbo.Portfolios AS p
INNER JOIN dbo.Regions AS r ON p.RegionId = r.Id
WHERE p.CompanyId IS NULL;

UPDATE dbo.Portfolios SET CompanyId = @MontiumId2 WHERE CompanyId IS NULL;

IF NOT EXISTS (
  SELECT 1 FROM dbo.Portfolios WHERE CompanyId IS NULL
)
BEGIN
  ALTER TABLE dbo.Portfolios ALTER COLUMN CompanyId INT NOT NULL;
END
ELSE
BEGIN
  RAISERROR(N'Portfolios still have NULL CompanyId after backfill.', 16, 1);
  RETURN;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Portfolios_Companies'
)
  ALTER TABLE dbo.Portfolios
    ADD CONSTRAINT FK_Portfolios_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_Portfolios_CompanyId' AND object_id = OBJECT_ID(N'dbo.Portfolios')
)
  CREATE INDEX IX_Portfolios_CompanyId ON dbo.Portfolios (CompanyId);
GO

/* -------- Properties -------- */
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Properties') AND name = N'CompanyId'
)
BEGIN
  ALTER TABLE dbo.Properties ADD CompanyId INT NULL;
END
GO

DECLARE @MontiumId3 INT;
SELECT @MontiumId3 = Id FROM dbo.Companies WHERE Name = N'Montium';

UPDATE pr
SET pr.CompanyId = p.CompanyId
FROM dbo.Properties AS pr
INNER JOIN dbo.Portfolios AS p ON pr.PortfolioId = p.Id
WHERE pr.CompanyId IS NULL AND p.CompanyId IS NOT NULL;

UPDATE pr
SET pr.CompanyId = r.CompanyId
FROM dbo.Properties AS pr
INNER JOIN dbo.Portfolios AS p ON pr.PortfolioId = p.Id
INNER JOIN dbo.Regions AS r ON p.RegionId = r.Id
WHERE pr.CompanyId IS NULL;

UPDATE dbo.Properties SET CompanyId = @MontiumId3 WHERE CompanyId IS NULL;

IF NOT EXISTS (
  SELECT 1 FROM dbo.Properties WHERE CompanyId IS NULL
)
BEGIN
  ALTER TABLE dbo.Properties ALTER COLUMN CompanyId INT NOT NULL;
END
ELSE
BEGIN
  RAISERROR(N'Properties still have NULL CompanyId after backfill.', 16, 1);
  RETURN;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Properties_Companies'
)
  ALTER TABLE dbo.Properties
    ADD CONSTRAINT FK_Properties_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_Properties_CompanyId' AND object_id = OBJECT_ID(N'dbo.Properties')
)
  CREATE INDEX IX_Properties_CompanyId ON dbo.Properties (CompanyId);
GO
