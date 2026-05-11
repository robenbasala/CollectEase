-- Extra columns on dbo.CompanyCollectionSettings: legal alerts, ERP link, legal list, theme, logo, display name.
-- Run after migrate-company-collection-settings.sql (table must exist).

IF OBJECT_ID(N'dbo.CompanyCollectionSettings', N'U') IS NULL
BEGIN
  RAISERROR('CompanyCollectionSettings not found. Run migrate-company-collection-settings.sql first.', 16, 1);
  RETURN;
END
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'LegalAlertAmount') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD LegalAlertAmount DECIMAL(18, 4) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'LegalAlertDays') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD LegalAlertDays INT NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'LegalAlertMonths') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD LegalAlertMonths DECIMAL(18, 4) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'ErpStaticLink') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD ErpStaticLink NVARCHAR(2000) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'DefaultLegalStatusList') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD DefaultLegalStatusList NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'ThemeKey') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD ThemeKey NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'LogoDataUrl') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD LogoDataUrl NVARCHAR(MAX) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'CompanyDisplayName') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD CompanyDisplayName NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.CompanyCollectionSettings', N'UnitDetailColumnPrefs') IS NULL
  ALTER TABLE dbo.CompanyCollectionSettings ADD UnitDetailColumnPrefs NVARCHAR(MAX) NULL;
GO
