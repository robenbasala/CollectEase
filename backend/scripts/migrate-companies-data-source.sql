-- Optional PMS / data source for each tenant: Yardi, Appfolio, Landlord
IF COL_LENGTH(N'dbo.Companies', N'DataSource') IS NULL
BEGIN
  ALTER TABLE dbo.Companies ADD DataSource NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Companies_DataSource'
)
BEGIN
  ALTER TABLE dbo.Companies
    ADD CONSTRAINT CK_Companies_DataSource
    CHECK (DataSource IS NULL OR DataSource IN (N'Yardi', N'Appfolio', N'Landlord'));
END
GO
