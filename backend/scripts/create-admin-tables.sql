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

IF OBJECT_ID(N'dbo.ReminderEmailLog', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReminderEmailLog (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    [Type] NVARCHAR(32) NOT NULL CONSTRAINT DF_ReminderEmailLog_Type DEFAULT N'reminder',
    SenderMailbox NVARCHAR(320) NOT NULL,
    ToEmail NVARCHAR(320) NOT NULL,
    Subject NVARCHAR(500) NULL,
    SentAt DATETIME2 NOT NULL CONSTRAINT DF_ReminderEmailLog_SentAt DEFAULT SYSUTCDATETIME(),
    GraphMessageId NVARCHAR(450) NOT NULL,
    GraphConversationId NVARCHAR(450) NOT NULL,
    TenantLabel NVARCHAR(500) NULL,
    PropertyName NVARCHAR(500) NULL,
    BodyPreview NVARCHAR(2000) NULL,
    CONSTRAINT FK_ReminderEmailLog_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_ReminderEmailLog_Type CHECK ([Type] IN (N'reminder', N'invite'))
  );
  CREATE INDEX IX_ReminderEmailLog_Company_SentAt ON dbo.ReminderEmailLog (CompanyId, SentAt DESC);
END
GO

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

-- Legal status preset lists are GLOBAL (shared across all companies).
-- Each property still picks its own list via Properties.ListName.
IF OBJECT_ID(N'dbo.LegalStatusPresetList', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalStatusPresetList (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalStatusPresetList_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_LegalStatusPresetList_Name UNIQUE (Name)
  );
END
GO

IF OBJECT_ID(N'dbo.LegalStatusPresetOption', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalStatusPresetOption (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ListId INT NOT NULL,
    Status NVARCHAR(200) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_LegalStatusPresetOption_SortOrder DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalStatusPresetOption_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LegalStatusPresetOption_List FOREIGN KEY (ListId) REFERENCES dbo.LegalStatusPresetList (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_LegalStatusPresetOption_ListStatus UNIQUE (ListId, Status)
  );
  CREATE INDEX IX_LegalStatusPresetOption_List ON dbo.LegalStatusPresetOption (ListId, SortOrder, Id);
END
GO

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
    InitialNote NVARCHAR(MAX) NULL,
    FollowUpAt DATETIME2 NULL,
    IsClosed BIT NOT NULL CONSTRAINT DF_UnitLegalCase_IsClosed DEFAULT 0,
    ClosedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UnitLegalCase_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedByName NVARCHAR(256) NULL,
    CONSTRAINT FK_UnitLegalCase_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_UnitLegalCase_OpenMonth CHECK (OpenMonth BETWEEN 1 AND 12),
    CONSTRAINT CK_UnitLegalCase_OpenYear CHECK (OpenYear BETWEEN 1900 AND 9999)
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

IF OBJECT_ID(N'dbo.AppUser', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppUser (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    FirebaseUid NVARCHAR(128) NOT NULL,
    Email NVARCHAR(320) NOT NULL,
    DisplayName NVARCHAR(200) NULL,
    CompanyId INT NOT NULL,
    Role NVARCHAR(32) NOT NULL CONSTRAINT DF_AppUser_Role DEFAULT N'member',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AppUser_FirebaseUid UNIQUE (FirebaseUid),
    CONSTRAINT FK_AppUser_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_AppUser_Role CHECK (Role IN (N'super_admin', N'company_admin', N'member'))
  );
  CREATE INDEX IX_AppUser_Email ON dbo.AppUser (Email);
  CREATE INDEX IX_AppUser_Company ON dbo.AppUser (CompanyId);
END
GO

IF OBJECT_ID(N'dbo.UserPropertyAccess', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserPropertyAccess (
    AppUserId INT NOT NULL,
    PropertyId INT NOT NULL,
    CONSTRAINT PK_UserPropertyAccess PRIMARY KEY (AppUserId, PropertyId),
    CONSTRAINT FK_UPA_AppUser FOREIGN KEY (AppUserId) REFERENCES dbo.AppUser (Id) ON DELETE CASCADE,
    CONSTRAINT FK_UPA_Property FOREIGN KEY (PropertyId) REFERENCES dbo.Properties (Id) ON DELETE CASCADE
  );
END
GO

IF OBJECT_ID(N'dbo.UserInvitation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserInvitation (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Email NVARCHAR(320) NOT NULL,
    CompanyId INT NOT NULL,
    Role NVARCHAR(32) NOT NULL,
    PropertyIdsJson NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UserInvitation_CreatedAt DEFAULT SYSUTCDATETIME(),
    ConsumedAt DATETIME2 NULL,
    CreatedByAppUserId INT NULL,
    CONSTRAINT FK_UserInvitation_Company FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT FK_UserInvitation_Creator FOREIGN KEY (CreatedByAppUserId) REFERENCES dbo.AppUser (Id),
    CONSTRAINT CK_UserInvitation_Role CHECK (Role IN (N'company_admin', N'member'))
  );
  CREATE INDEX IX_UserInvitation_Email_Active ON dbo.UserInvitation (Email) WHERE ConsumedAt IS NULL;
END
GO
