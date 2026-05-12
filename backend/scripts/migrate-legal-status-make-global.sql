-- Make legal status preset lists GLOBAL (shared across all companies).
--
-- Previously each company had its own copy of every list. This migration:
--   1) Deduplicates LegalStatusPresetList rows by Name (keeps the row with the smallest Id).
--   2) Re-points LegalStatusPresetOption rows on duplicate lists to the kept list, skipping
--      (ListId, Status) collisions so the existing UNIQUE survives.
--   3) Deletes the now-orphaned duplicate rows.
--   4) Drops CompanyId/FK/indexes/uniques referencing CompanyId from both tables.
--   5) Adds a new UNIQUE (Name) on LegalStatusPresetList.
--
-- Properties.ListName values stay valid because the kept rows keep their original names.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-- ---------- Step 1: deduplicate + repoint options ----------
IF OBJECT_ID(N'dbo.LegalStatusPresetList', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.LegalStatusPresetList', N'CompanyId') IS NOT NULL
BEGIN
  DECLARE @Keepers TABLE (Name NVARCHAR(100) PRIMARY KEY, KeepId INT NOT NULL);

  INSERT INTO @Keepers (Name, KeepId)
  SELECT Name, MIN(Id)
  FROM dbo.LegalStatusPresetList
  GROUP BY Name;

  -- Copy options that exist only on the duplicates over to the keeper list.
  INSERT INTO dbo.LegalStatusPresetOption (CompanyId, ListId, Status, SortOrder, CreatedAt)
  SELECT o.CompanyId, k.KeepId, o.Status, o.SortOrder, o.CreatedAt
  FROM dbo.LegalStatusPresetOption o
  INNER JOIN dbo.LegalStatusPresetList l ON l.Id = o.ListId
  INNER JOIN @Keepers k ON k.Name = l.Name AND k.KeepId <> l.Id
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.LegalStatusPresetOption existing
    WHERE existing.ListId = k.KeepId AND existing.Status = o.Status
  );

  -- Remove options pointing at the duplicate (non-keeper) lists.
  DELETE o
  FROM dbo.LegalStatusPresetOption o
  INNER JOIN dbo.LegalStatusPresetList l ON l.Id = o.ListId
  INNER JOIN @Keepers k ON k.Name = l.Name AND k.KeepId <> l.Id;

  -- Remove the duplicate list rows themselves.
  DELETE l
  FROM dbo.LegalStatusPresetList l
  INNER JOIN @Keepers k ON k.Name = l.Name AND k.KeepId <> l.Id;
END
GO

-- ---------- Step 2: drop CompanyId from LegalStatusPresetOption ----------
IF OBJECT_ID(N'dbo.LegalStatusPresetOption', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.LegalStatusPresetOption', N'CompanyId') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_LegalStatusPresetOption_Companies')
    ALTER TABLE dbo.LegalStatusPresetOption DROP CONSTRAINT FK_LegalStatusPresetOption_Companies;
  ALTER TABLE dbo.LegalStatusPresetOption DROP COLUMN CompanyId;
END
GO

-- ---------- Step 3: drop CompanyId + related indexes/uniques from LegalStatusPresetList ----------
IF OBJECT_ID(N'dbo.LegalStatusPresetList', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.LegalStatusPresetList', N'CompanyId') IS NOT NULL
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_LegalStatusPresetList_CompanyName'
      AND object_id = OBJECT_ID(N'dbo.LegalStatusPresetList')
  )
    ALTER TABLE dbo.LegalStatusPresetList DROP CONSTRAINT UQ_LegalStatusPresetList_CompanyName;

  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_LegalStatusPresetList_Company'
      AND object_id = OBJECT_ID(N'dbo.LegalStatusPresetList')
  )
    DROP INDEX IX_LegalStatusPresetList_Company ON dbo.LegalStatusPresetList;

  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_LegalStatusPresetList_Companies')
    ALTER TABLE dbo.LegalStatusPresetList DROP CONSTRAINT FK_LegalStatusPresetList_Companies;

  ALTER TABLE dbo.LegalStatusPresetList DROP COLUMN CompanyId;
END
GO

-- ---------- Step 4: enforce uniqueness on Name alone ----------
IF OBJECT_ID(N'dbo.LegalStatusPresetList', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE name = N'UQ_LegalStatusPresetList_Name'
       AND object_id = OBJECT_ID(N'dbo.LegalStatusPresetList')
   )
BEGIN
  ALTER TABLE dbo.LegalStatusPresetList
    ADD CONSTRAINT UQ_LegalStatusPresetList_Name UNIQUE (Name);
END
GO
