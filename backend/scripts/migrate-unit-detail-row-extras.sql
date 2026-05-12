-- Notes + legal status history for unit detail row (keyed by company + property + unit + tenant name).
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.UnitDetailNote', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UnitDetailNote (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    PropertyName NVARCHAR(400) NOT NULL,
    Unit NVARCHAR(400) NOT NULL,
    TenantName NVARCHAR(400) NOT NULL,
    TenantCode NVARCHAR(200) NULL,
    Body NVARCHAR(4000) NOT NULL,
    IsPinned BIT NOT NULL CONSTRAINT DF_UnitDetailNote_IsPinned DEFAULT 0,
    IsHighlighted BIT NOT NULL CONSTRAINT DF_UnitDetailNote_IsHighlighted DEFAULT 0,
    CreatedByName NVARCHAR(256) NULL,
    NoteSource NVARCHAR(16) NOT NULL CONSTRAINT DF_UnitDetailNote_NoteSource DEFAULT N'manual',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UnitDetailNote_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_UnitDetailNote_NoteSource CHECK (NoteSource IN (N'manual', N'auto')),
    CONSTRAINT FK_UnitDetailNote_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
  CREATE INDEX IX_UnitDetailNote_Lookup ON dbo.UnitDetailNote (CompanyId, PropertyName, Unit, TenantName);
END
GO

IF OBJECT_ID(N'dbo.UnitLegalStatusHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UnitLegalStatusHistory (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    PropertyName NVARCHAR(400) NOT NULL,
    Unit NVARCHAR(400) NOT NULL,
    TenantName NVARCHAR(400) NOT NULL,
    TenantCode NVARCHAR(200) NULL,
    OldStatus NVARCHAR(400) NULL,
    NewStatus NVARCHAR(400) NOT NULL,
    ChangedAt DATETIME2 NOT NULL CONSTRAINT DF_UnitLegalStatusHistory_ChangedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UnitLegalStatusHistory_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
  CREATE INDEX IX_UnitLegalStatusHistory_Lookup ON dbo.UnitLegalStatusHistory (CompanyId, PropertyName, Unit, TenantName, ChangedAt DESC);
END
GO
