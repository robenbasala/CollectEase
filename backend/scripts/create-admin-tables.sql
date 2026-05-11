-- Fresh install: Companies, Regions, Portfolios, Properties (all scoped by CompanyId).
-- Existing databases: run migrate-multitenant-companies.sql then migrate-portfolios-properties-companyid.sql

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

IF OBJECT_ID(N'dbo.Regions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Regions (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    CONSTRAINT FK_Regions_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
END
GO

IF OBJECT_ID(N'dbo.Portfolios', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Portfolios (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RegionId INT NOT NULL,
    CompanyId INT NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    CONSTRAINT FK_Portfolios_Regions FOREIGN KEY (RegionId) REFERENCES dbo.Regions (Id),
    CONSTRAINT FK_Portfolios_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
END
GO

IF OBJECT_ID(N'dbo.Properties', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Properties (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    PortfolioId INT NOT NULL,
    CompanyId INT NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    ListName NVARCHAR(100) NULL,
    CONSTRAINT FK_Properties_Portfolios FOREIGN KEY (PortfolioId) REFERENCES dbo.Portfolios (Id),
    CONSTRAINT FK_Properties_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
END
GO

IF OBJECT_ID(N'dbo.CompanyCollectionSettings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyCollectionSettings (
    CompanyId INT NOT NULL PRIMARY KEY,
    FollowupAmount DECIMAL(18, 4) NULL,
    FollowupDays INT NULL,
    FollowupMonths DECIMAL(18, 4) NULL,
    LegalAlertAmount DECIMAL(18, 4) NULL,
    LegalAlertDays INT NULL,
    LegalAlertMonths DECIMAL(18, 4) NULL,
    ErpStaticLink NVARCHAR(2000) NULL,
    DefaultLegalStatusList NVARCHAR(200) NULL,
    ThemeKey NVARCHAR(50) NULL,
    LogoDataUrl NVARCHAR(MAX) NULL,
    CompanyDisplayName NVARCHAR(200) NULL,
    UnitDetailColumnPrefs NVARCHAR(MAX) NULL,
    CONSTRAINT FK_CompanyCollectionSettings_Companies
      FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
END
GO
