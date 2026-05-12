-- Remove the auto-seeded List1/List2/List3 preset lists.
-- Earlier migrations seeded these for every company; the admin UI now manages presets
-- explicitly, so the defaults are no longer wanted.
--
-- Properties.ListName references to the deleted lists are cleared so the property
-- falls back to whatever lookup logic applies (company default or none).

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.LegalStatusPresetList', N'U') IS NOT NULL
BEGIN
  -- Clear property references to the default lists so the FK / lookup chain stays consistent.
  IF OBJECT_ID(N'dbo.Properties', N'U') IS NOT NULL
  BEGIN
    UPDATE dbo.Properties
    SET ListName = NULL
    WHERE ListName IN (N'List1', N'List2', N'List3');
  END

  -- Clear the company default if it referenced one of the defaults.
  IF OBJECT_ID(N'dbo.CompanyCollectionSettings', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.CompanyCollectionSettings', N'DefaultLegalStatusList') IS NOT NULL
  BEGIN
    UPDATE dbo.CompanyCollectionSettings
    SET DefaultLegalStatusList = NULL
    WHERE DefaultLegalStatusList IN (N'List1', N'List2', N'List3');
  END

  -- Drop the default lists (cascade removes their options).
  DELETE FROM dbo.LegalStatusPresetList WHERE Name IN (N'List1', N'List2', N'List3');
END
GO
