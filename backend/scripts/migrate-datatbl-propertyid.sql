/*
  Links dbo.DataTbl rows to dbo.Properties via PropertyId (DataTbl has no "Name" for the building —
  Name lives on dbo.Properties only).

  Run once on CollectEase (or your DB). Backfill PropertyId separately if needed, e.g. match by
  legacy text columns then:
    UPDATE dt SET PropertyId = pr.Id FROM dbo.DataTbl dt ...
*/

SET NOCOUNT ON;

IF COL_LENGTH(N'dbo.DataTbl', N'PropertyId') IS NULL
BEGIN
  ALTER TABLE dbo.DataTbl ADD PropertyId INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_DataTbl_Properties' AND parent_object_id = OBJECT_ID(N'dbo.DataTbl')
)
BEGIN
  ALTER TABLE dbo.DataTbl
    ADD CONSTRAINT FK_DataTbl_Properties FOREIGN KEY (PropertyId) REFERENCES dbo.Properties (Id);
END
GO
