-- Legacy SQL tables for users/invites. Current app uses Firebase Auth + custom claims only (no Firestore for users).
-- Safe to skip on new installs that use Firestore only; keep if you still migrate old data.
-- App users (Firebase), property ACL, email-link invitations.
SET NOCOUNT ON;

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
  CREATE INDEX IX_UserInvitation_Email_Active
    ON dbo.UserInvitation (Email)
    WHERE ConsumedAt IS NULL;
END
GO
