-- Expand CompanyDataflow schedule types: hourly, weekly.
-- Run: node backend/scripts/run-migration.js backend/scripts/migrate-company-dataflows-schedule-expand.sql

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.CompanyDataflow', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_CompanyDataflow_ScheduleType')
    ALTER TABLE dbo.CompanyDataflow DROP CONSTRAINT CK_CompanyDataflow_ScheduleType;

  ALTER TABLE dbo.CompanyDataflow ADD CONSTRAINT CK_CompanyDataflow_ScheduleType CHECK (
    ScheduleType IN (N'manual', N'interval_minutes', N'hourly', N'daily', N'weekly')
  );
END
GO
