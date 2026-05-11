-- Per-company JSON prefs for Property details unit table (visible columns + order). Scoped by CompanyId.
-- Run after migrate-company-settings-extended.sql (CompanyCollectionSettings must exist).

IF OBJECT_ID(N'dbo.CompanyCollectionSettings', N'U') IS NULL
BEGIN
  RAISERROR('CompanyCollectionSettings not found.', 16, 1);
  RETURN;
END
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'UnitDetailColumnPrefs') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD UnitDetailColumnPrefs NVARCHAR(MAX) NULL;
GO
