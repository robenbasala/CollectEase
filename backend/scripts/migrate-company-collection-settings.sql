-- Per-company collection / follow-up thresholds (dashboard "Missing follow up" alert).
-- Run once on existing DBs. Fresh installs: also included in create-admin-tables.sql.

IF OBJECT_ID(N'dbo.CompanyCollectionSettings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyCollectionSettings (
    CompanyId INT NOT NULL PRIMARY KEY,
    FollowupAmount DECIMAL(18, 4) NULL,
    FollowupDays INT NULL,
    FollowupMonths DECIMAL(18, 4) NULL,
    CONSTRAINT FK_CompanyCollectionSettings_Companies
      FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
END
GO
