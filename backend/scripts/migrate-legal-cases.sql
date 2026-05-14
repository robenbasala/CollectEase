-- Legal case workflow for the Unit workspace modal.
-- Replaces the single "legal status" column workflow with multi-case tracking.
--   1) UnitLegalCase             : a discrete case opened for a tenant (year/month/note/follow-up)
--   2) UnitLegalCaseStatus       : status entries logged against a case (court history)
-- Legal status options themselves live in named preset lists; see migrate-legal-status-presets.sql.
--
-- Run with `node backend/scripts/run-migration.js backend/scripts/migrate-legal-cases.sql`.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.UnitLegalCase', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UnitLegalCase (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    PropertyName NVARCHAR(400) NOT NULL,
    Unit NVARCHAR(400) NOT NULL,
    TenantName NVARCHAR(400) NOT NULL,
    TenantCode NVARCHAR(200) NULL,
    OpenYear SMALLINT NOT NULL,
    OpenMonth TINYINT NOT NULL,
    OpenEndYear SMALLINT NULL,
    OpenEndMonth TINYINT NULL,
    InitialNote NVARCHAR(MAX) NULL,
    FollowUpAt DATETIME2 NULL,
    IsClosed BIT NOT NULL CONSTRAINT DF_UnitLegalCase_IsClosed DEFAULT 0,
    ClosedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UnitLegalCase_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedByName NVARCHAR(256) NULL,
    CONSTRAINT FK_UnitLegalCase_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_UnitLegalCase_OpenMonth CHECK (OpenMonth BETWEEN 1 AND 12),
    CONSTRAINT CK_UnitLegalCase_OpenYear CHECK (OpenYear BETWEEN 1900 AND 9999),
    CONSTRAINT CK_UnitLegalCase_OpenEndYear CHECK (OpenEndYear IS NULL OR (OpenEndYear BETWEEN 1900 AND 9999)),
    CONSTRAINT CK_UnitLegalCase_OpenEndMonth CHECK (OpenEndMonth IS NULL OR (OpenEndMonth BETWEEN 1 AND 12)),
    CONSTRAINT CK_UnitLegalCase_OpenEndPair CHECK (
      (OpenEndYear IS NULL AND OpenEndMonth IS NULL)
      OR (OpenEndYear IS NOT NULL AND OpenEndMonth IS NOT NULL)
    )
  );
  CREATE INDEX IX_UnitLegalCase_Lookup ON dbo.UnitLegalCase (CompanyId, PropertyName, Unit, TenantName, IsClosed, CreatedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.UnitLegalCaseStatus', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UnitLegalCaseStatus (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CaseId INT NOT NULL,
    Status NVARCHAR(200) NOT NULL,
    Note NVARCHAR(MAX) NULL,
    ChangedAt DATETIME2 NOT NULL CONSTRAINT DF_UnitLegalCaseStatus_ChangedAt DEFAULT SYSUTCDATETIME(),
    CreatedByName NVARCHAR(256) NULL,
    CONSTRAINT FK_UnitLegalCaseStatus_Case FOREIGN KEY (CaseId) REFERENCES dbo.UnitLegalCase (Id) ON DELETE CASCADE
  );
  CREATE INDEX IX_UnitLegalCaseStatus_Case ON dbo.UnitLegalCaseStatus (CaseId, ChangedAt DESC);
END
GO
