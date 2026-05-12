-- Author label on unit detail notes (shown in UI).
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.UnitDetailNote', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.UnitDetailNote')
      AND c.name = N'CreatedByName'
  )
BEGIN
  ALTER TABLE dbo.UnitDetailNote ADD CreatedByName NVARCHAR(256) NULL;
END
GO
