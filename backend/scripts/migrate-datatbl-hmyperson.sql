-- Optional: Hmyperson on dbo.DataTbl for ERP deep-links (Settings.ErpStaticLink + Hmyperson).
-- Skip if [Hmyperson] already exists in your environment.

IF COL_LENGTH(N'dbo.DataTbl', N'Hmyperson') IS NULL
BEGIN
  ALTER TABLE dbo.DataTbl ADD Hmyperson NVARCHAR(200) NULL;
END
