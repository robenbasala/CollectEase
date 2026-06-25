-- Schedule + last-run metadata on Dataverse ETL flows (per company mapping)

IF COL_LENGTH(N'dbo.EtlDataverseMappings', N'ScheduleType') IS NULL
BEGIN
  ALTER TABLE dbo.EtlDataverseMappings ADD ScheduleType NVARCHAR(32) NOT NULL
    CONSTRAINT DF_EtlDvMap_ScheduleType DEFAULT N'manual';
END
GO

IF COL_LENGTH(N'dbo.EtlDataverseMappings', N'ScheduleValue') IS NULL
BEGIN
  ALTER TABLE dbo.EtlDataverseMappings ADD ScheduleValue NVARCHAR(200) NULL;
END
GO

IF COL_LENGTH(N'dbo.EtlDataverseMappings', N'IsEnabled') IS NULL
BEGIN
  ALTER TABLE dbo.EtlDataverseMappings ADD IsEnabled BIT NOT NULL
    CONSTRAINT DF_EtlDvMap_Enabled DEFAULT 1;
END
GO

IF COL_LENGTH(N'dbo.EtlDataverseMappings', N'LastRunAt') IS NULL
BEGIN
  ALTER TABLE dbo.EtlDataverseMappings ADD LastRunAt DATETIME2 NULL;
END
GO

IF COL_LENGTH(N'dbo.EtlDataverseMappings', N'LastRunStatus') IS NULL
BEGIN
  ALTER TABLE dbo.EtlDataverseMappings ADD LastRunStatus NVARCHAR(50) NULL;
END
GO

IF COL_LENGTH(N'dbo.EtlImportLogs', N'TriggerType') IS NULL
BEGIN
  ALTER TABLE dbo.EtlImportLogs ADD TriggerType NVARCHAR(32) NULL;
END
GO
