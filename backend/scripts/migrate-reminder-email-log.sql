-- Payment reminder send log (per company). Run once on existing DBs.
IF OBJECT_ID(N'dbo.ReminderEmailLog', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReminderEmailLog (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    SenderMailbox NVARCHAR(320) NOT NULL,
    ToEmail NVARCHAR(320) NOT NULL,
    Subject NVARCHAR(500) NULL,
    SentAt DATETIME2 NOT NULL CONSTRAINT DF_ReminderEmailLog_SentAt DEFAULT SYSUTCDATETIME(),
    GraphMessageId NVARCHAR(450) NOT NULL,
    GraphConversationId NVARCHAR(450) NOT NULL,
    TenantLabel NVARCHAR(500) NULL,
    PropertyName NVARCHAR(500) NULL,
    BodyPreview NVARCHAR(2000) NULL,
    CONSTRAINT FK_ReminderEmailLog_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)
  );
  CREATE INDEX IX_ReminderEmailLog_Company_SentAt ON dbo.ReminderEmailLog (CompanyId, SentAt DESC);
END
GO
