-- User-editable follow-up on dbo.DataTbl (separate from imported NextFollowUp).
IF COL_LENGTH(N'dbo.DataTbl', N'TenantFollowUp') IS NULL
BEGIN
  ALTER TABLE dbo.DataTbl ADD TenantFollowUp DATETIME2 NULL;
END
