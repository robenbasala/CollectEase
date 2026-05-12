-- manual vs auto unit notes (auto = e.g. payment reminder sent log).
-- Two batches: SQL Server parses the whole batch before run, so CHECK cannot
-- reference NoteSource in the same batch as the first ADD of that column (Msg 207).
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.UnitDetailNote', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.UnitDetailNote')
      AND c.name = N'NoteSource'
  )
BEGIN
  ALTER TABLE dbo.UnitDetailNote ADD NoteSource NVARCHAR(16) NOT NULL CONSTRAINT DF_UnitDetailNote_NoteSource DEFAULT N'manual';
END
GO

IF OBJECT_ID(N'dbo.UnitDetailNote', N'U') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.UnitDetailNote')
      AND c.name = N'NoteSource'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID(N'dbo.UnitDetailNote')
      AND cc.name = N'CK_UnitDetailNote_NoteSource'
  )
BEGIN
  ALTER TABLE dbo.UnitDetailNote ADD CONSTRAINT CK_UnitDetailNote_NoteSource CHECK (NoteSource IN (N'manual', N'auto'));
END
GO
