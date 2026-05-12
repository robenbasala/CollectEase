-- Adds a Type column to ReminderEmailLog so we can log both payment reminders and user invitations.
-- Run once on existing databases. Safe to re-run.
-- Split into separate batches: SQL Server compiles a whole batch first, so adding a CHECK that
-- references a column in the same batch where the column is added fails with "Invalid column name".
IF OBJECT_ID(N'dbo.ReminderEmailLog', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
     FROM sys.columns
     WHERE [object_id] = OBJECT_ID(N'dbo.ReminderEmailLog')
       AND [name] = N'Type'
   )
BEGIN
  ALTER TABLE dbo.ReminderEmailLog
    ADD [Type] NVARCHAR(32) NOT NULL
      CONSTRAINT DF_ReminderEmailLog_Type DEFAULT N'reminder';
END
GO

IF OBJECT_ID(N'dbo.ReminderEmailLog', N'U') IS NOT NULL
   AND EXISTS (
     SELECT 1
     FROM sys.columns
     WHERE [object_id] = OBJECT_ID(N'dbo.ReminderEmailLog')
       AND [name] = N'Type'
   )
   AND NOT EXISTS (
     SELECT 1
     FROM sys.check_constraints
     WHERE [parent_object_id] = OBJECT_ID(N'dbo.ReminderEmailLog')
       AND [name] = N'CK_ReminderEmailLog_Type'
   )
BEGIN
  ALTER TABLE dbo.ReminderEmailLog
    ADD CONSTRAINT CK_ReminderEmailLog_Type CHECK ([Type] IN (N'reminder', N'invite'));
END
GO
