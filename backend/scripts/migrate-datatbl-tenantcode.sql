-- Optional: TenantCode on dbo.DataTbl for ERP deep-links (Settings.ErpStaticLink + TenantCode).
-- Skip if [TenantCode] already exists in your environment.

IF COL_LENGTH(N'dbo.DataTbl', N'TenantCode') IS NULL
BEGIN
  ALTER TABLE dbo.DataTbl ADD TenantCode NVARCHAR(200) NULL;
END
