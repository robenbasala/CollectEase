/*
  Multi-tenant: Companies + CompanyId on dbo.Regions and dbo.DataTbl.
  Seeds first company "Montium" and assigns existing rows to Montium.
  Run once against your database (e.g. CollectEase).
*/

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.Companies', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Companies (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    CONSTRAINT UQ_Companies_Name UNIQUE (Name)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Companies WHERE Name = N'Montium')
  INSERT INTO dbo.Companies (Name) VALUES (N'Montium');
GO

DECLARE @MontiumId INT;
SELECT @MontiumId = Id FROM dbo.Companies WHERE Name = N'Montium';

IF @MontiumId IS NULL
BEGIN
  RAISERROR(N'Montium company row missing.', 16, 1);
  RETURN;
END

/* Regions.CompanyId */
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.Regions') AND name = N'CompanyId'
)
BEGIN
  ALTER TABLE dbo.Regions ADD CompanyId INT NULL;
  UPDATE dbo.Regions SET CompanyId = @MontiumId WHERE CompanyId IS NULL;
  ALTER TABLE dbo.Regions ALTER COLUMN CompanyId INT NOT NULL;
  ALTER TABLE dbo.Regions
    ADD CONSTRAINT FK_Regions_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
END
GO

DECLARE @MontiumId2 INT;
SELECT @MontiumId2 = Id FROM dbo.Companies WHERE Name = N'Montium';

/* DataTbl.CompanyId */
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.DataTbl') AND name = N'CompanyId'
)
BEGIN
  ALTER TABLE dbo.DataTbl ADD CompanyId INT NULL;
  UPDATE dbo.DataTbl SET CompanyId = @MontiumId2
  WHERE CompanyId IS NULL;
  ALTER TABLE dbo.DataTbl ALTER COLUMN CompanyId INT NOT NULL;
  ALTER TABLE dbo.DataTbl
    ADD CONSTRAINT FK_DataTbl_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_DataTbl_CompanyId' AND object_id = OBJECT_ID(N'dbo.DataTbl')
)
  CREATE INDEX IX_DataTbl_CompanyId ON dbo.DataTbl (CompanyId);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_Regions_CompanyId' AND object_id = OBJECT_ID(N'dbo.Regions')
)
  CREATE INDEX IX_Regions_CompanyId ON dbo.Regions (CompanyId);
GO
