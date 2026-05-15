-- Company Dataflows: Excel ingest, JSON transformation pipeline, SQL upsert, run history.
-- Run: node backend/scripts/run-migration.js backend/scripts/migrate-company-dataflows.sql

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.CompanyDataflow', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyDataflow (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CompanyId INT NOT NULL,
    Name NVARCHAR(500) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    SourceType NVARCHAR(32) NOT NULL CONSTRAINT DF_CompanyDataflow_SourceType DEFAULT N'local_path',
    SourcePath NVARCHAR(2000) NOT NULL,
    SheetName NVARCHAR(200) NULL,
    ExcelTableName NVARCHAR(200) NULL,
    TransformationScript NVARCHAR(MAX) NULL,
    DestinationTable NVARCHAR(256) NOT NULL,
    UniqueKeyColumn NVARCHAR(128) NOT NULL,
    UpsertMode NVARCHAR(32) NOT NULL CONSTRAINT DF_CompanyDataflow_UpsertMode DEFAULT N'insert_update',
    ScheduleType NVARCHAR(32) NOT NULL CONSTRAINT DF_CompanyDataflow_ScheduleType DEFAULT N'manual',
    ScheduleValue NVARCHAR(200) NULL,
    IsEnabled BIT NOT NULL CONSTRAINT DF_CompanyDataflow_IsEnabled DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CompanyDataflow_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CompanyDataflow_UpdatedAt DEFAULT SYSUTCDATETIME(),
    LastRunAt DATETIME2 NULL,
    LastRunStatus NVARCHAR(32) NULL,
    LastRunMessage NVARCHAR(2000) NULL,
    CONSTRAINT FK_CompanyDataflow_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_CompanyDataflow_SourceType CHECK (
      SourceType IN (N'local_path', N'url', N'sharepoint')
    ),
    CONSTRAINT CK_CompanyDataflow_UpsertMode CHECK (
      UpsertMode IN (N'insert_only', N'update_only', N'insert_update')
    ),
    CONSTRAINT CK_CompanyDataflow_ScheduleType CHECK (
      ScheduleType IN (N'manual', N'interval_minutes', N'hourly', N'daily', N'weekly')
    )
  );
  CREATE INDEX IX_CompanyDataflow_Company ON dbo.CompanyDataflow (CompanyId, IsEnabled, Id);
END
GO

IF OBJECT_ID(N'dbo.CompanyDataflowMapping', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyDataflowMapping (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DataflowId INT NOT NULL,
    SourceColumn NVARCHAR(256) NOT NULL,
    DestinationColumn NVARCHAR(256) NOT NULL,
    DestinationDataType NVARCHAR(120) NULL,
    IsRequired BIT NOT NULL CONSTRAINT DF_CompanyDataflowMapping_IsRequired DEFAULT 0,
    IsMapped BIT NOT NULL CONSTRAINT DF_CompanyDataflowMapping_IsMapped DEFAULT 1,
    DefaultValue NVARCHAR(MAX) NULL,
    Expression NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CompanyDataflowMapping_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CompanyDataflowMapping_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CompanyDataflowMapping_Dataflow FOREIGN KEY (DataflowId) REFERENCES dbo.CompanyDataflow (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_CompanyDataflowMapping_Dest UNIQUE (DataflowId, DestinationColumn)
  );
  CREATE INDEX IX_CompanyDataflowMapping_Dataflow ON dbo.CompanyDataflowMapping (DataflowId);
END
GO

IF OBJECT_ID(N'dbo.CompanyDataflowRun', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyDataflowRun (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DataflowId INT NOT NULL,
    CompanyId INT NOT NULL,
    StartedAt DATETIME2 NOT NULL CONSTRAINT DF_CompanyDataflowRun_StartedAt DEFAULT SYSUTCDATETIME(),
    FinishedAt DATETIME2 NULL,
    Status NVARCHAR(32) NOT NULL CONSTRAINT DF_CompanyDataflowRun_Status DEFAULT N'Running',
    TotalRows INT NOT NULL CONSTRAINT DF_CompanyDataflowRun_TotalRows DEFAULT 0,
    InsertedRows INT NOT NULL CONSTRAINT DF_CompanyDataflowRun_InsertedRows DEFAULT 0,
    UpdatedRows INT NOT NULL CONSTRAINT DF_CompanyDataflowRun_UpdatedRows DEFAULT 0,
    SkippedRows INT NOT NULL CONSTRAINT DF_CompanyDataflowRun_SkippedRows DEFAULT 0,
    FailedRows INT NOT NULL CONSTRAINT DF_CompanyDataflowRun_FailedRows DEFAULT 0,
    ErrorMessage NVARCHAR(MAX) NULL,
    LogJson NVARCHAR(MAX) NULL,
    CONSTRAINT FK_CompanyDataflowRun_Dataflow FOREIGN KEY (DataflowId) REFERENCES dbo.CompanyDataflow (Id) ON DELETE CASCADE,
    CONSTRAINT FK_CompanyDataflowRun_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id),
    CONSTRAINT CK_CompanyDataflowRun_Status CHECK (
      Status IN (N'Running', N'Success', N'Failed', N'Partial')
    )
  );
  CREATE INDEX IX_CompanyDataflowRun_Dataflow ON dbo.CompanyDataflowRun (DataflowId, StartedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.CompanyDataflowRunError', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyDataflowRunError (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RunId INT NOT NULL,
    RowNumber INT NULL,
    UniqueKeyValue NVARCHAR(400) NULL,
    ErrorMessage NVARCHAR(2000) NOT NULL,
    RawRowJson NVARCHAR(MAX) NULL,
    CONSTRAINT FK_CompanyDataflowRunError_Run FOREIGN KEY (RunId) REFERENCES dbo.CompanyDataflowRun (Id) ON DELETE CASCADE
  );
  CREATE INDEX IX_CompanyDataflowRunError_Run ON dbo.CompanyDataflowRunError (RunId, Id);
END
GO
