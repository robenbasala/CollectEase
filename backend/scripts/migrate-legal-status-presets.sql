-- Legal status preset lists are GLOBAL (no CompanyId).
-- Status options are defined once per named preset list. Each property chooses which
-- preset to use via dbo.Properties.ListName.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

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
