-- Dataverse → SQL ETL (replaces legacy Excel dataflow config for imports)

IF OBJECT_ID(N'dbo.EtlDataverseConnections', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.EtlDataverseConnections (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    EnvironmentUrl NVARCHAR(500) NOT NULL,
    TenantId NVARCHAR(200) NOT NULL,
    ClientId NVARCHAR(200) NOT NULL,
    ClientSecretEncrypted NVARCHAR(MAX) NOT NULL,
    CompanyId INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlDvConn_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlDvConn_Updated DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_EtlDataverseConnections_Company ON dbo.EtlDataverseConnections (CompanyId);
END
GO

IF OBJECT_ID(N'dbo.EtlDataverseMappings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.EtlDataverseMappings (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    ConnectionId INT NOT NULL,
    SourceTableLogicalName NVARCHAR(200) NOT NULL,
    SourceEntitySetName NVARCHAR(200) NULL,
    DestinationTable NVARCHAR(200) NOT NULL CONSTRAINT DF_EtlDvMap_Dest DEFAULT N'dbo.DataTbl',
    UniqueKeyJson NVARCHAR(MAX) NOT NULL,
    MappingJson NVARCHAR(MAX) NOT NULL,
    ImportMode NVARCHAR(50) NOT NULL CONSTRAINT DF_EtlDvMap_Mode DEFAULT N'upsert',
    CompanyId INT NULL,
    BatchSize INT NOT NULL CONSTRAINT DF_EtlDvMap_Batch DEFAULT 500,
    ScheduleType NVARCHAR(32) NOT NULL CONSTRAINT DF_EtlDvMap_ScheduleType DEFAULT N'manual',
    ScheduleValue NVARCHAR(200) NULL,
    IsEnabled BIT NOT NULL CONSTRAINT DF_EtlDvMap_Enabled DEFAULT 1,
    LastRunAt DATETIME2 NULL,
    LastRunStatus NVARCHAR(50) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlDvMap_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlDvMap_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_EtlDvMap_Connection FOREIGN KEY (ConnectionId) REFERENCES dbo.EtlDataverseConnections(Id)
  );
  CREATE INDEX IX_EtlDataverseMappings_Connection ON dbo.EtlDataverseMappings (ConnectionId);
  CREATE INDEX IX_EtlDataverseMappings_Company ON dbo.EtlDataverseMappings (CompanyId);
END
GO

IF OBJECT_ID(N'dbo.EtlImportLogs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.EtlImportLogs (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    MappingId INT NULL,
    ConnectionId INT NULL,
    SourceTableLogicalName NVARCHAR(200) NULL,
    DestinationTable NVARCHAR(200) NULL,
    Status NVARCHAR(50) NOT NULL,
    StartedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlLog_Started DEFAULT SYSUTCDATETIME(),
    FinishedAt DATETIME2 NULL,
    TotalRead INT NOT NULL CONSTRAINT DF_EtlLog_Read DEFAULT 0,
    TotalInserted INT NOT NULL CONSTRAINT DF_EtlLog_Ins DEFAULT 0,
    TotalUpdated INT NOT NULL CONSTRAINT DF_EtlLog_Upd DEFAULT 0,
    TotalSkipped INT NOT NULL CONSTRAINT DF_EtlLog_Skip DEFAULT 0,
    TotalErrors INT NOT NULL CONSTRAINT DF_EtlLog_Err DEFAULT 0,
    ErrorSummary NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(200) NULL,
    CompanyId INT NULL,
    TriggerType NVARCHAR(32) NULL
  );
  CREATE INDEX IX_EtlImportLogs_Started ON dbo.EtlImportLogs (StartedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.EtlImportLogDetails', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.EtlImportLogDetails (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ImportLogId INT NOT NULL,
    RowNumber INT NULL,
    SourceRecordId NVARCHAR(200) NULL,
    Status NVARCHAR(50) NOT NULL,
    ErrorMessage NVARCHAR(MAX) NULL,
    SourceJson NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EtlLogDet_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_EtlLogDet_Log FOREIGN KEY (ImportLogId) REFERENCES dbo.EtlImportLogs(Id) ON DELETE CASCADE
  );
  CREATE INDEX IX_EtlImportLogDetails_Log ON dbo.EtlImportLogDetails (ImportLogId);
END
GO
