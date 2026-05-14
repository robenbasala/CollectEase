-- Add optional end of open-month range on UnitLegalCase (FROM = OpenYear/OpenMonth, TO = OpenEnd*).
-- NULL end means a single calendar month (legacy rows and same-month selections).
--
-- Run with `node backend/scripts/run-migration.js backend/scripts/migrate-legal-case-month-range.sql`.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH(N'dbo.UnitLegalCase', N'OpenEndYear') IS NULL
BEGIN
  ALTER TABLE dbo.UnitLegalCase ADD OpenEndYear SMALLINT NULL;
END
GO

IF COL_LENGTH(N'dbo.UnitLegalCase', N'OpenEndMonth') IS NULL
BEGIN
  ALTER TABLE dbo.UnitLegalCase ADD OpenEndMonth TINYINT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_UnitLegalCase_OpenEndYear' AND parent_object_id = OBJECT_ID(N'dbo.UnitLegalCase')
)
BEGIN
  ALTER TABLE dbo.UnitLegalCase
    ADD CONSTRAINT CK_UnitLegalCase_OpenEndYear
    CHECK (OpenEndYear IS NULL OR (OpenEndYear BETWEEN 1900 AND 9999));
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_UnitLegalCase_OpenEndMonth' AND parent_object_id = OBJECT_ID(N'dbo.UnitLegalCase')
)
BEGIN
  ALTER TABLE dbo.UnitLegalCase
    ADD CONSTRAINT CK_UnitLegalCase_OpenEndMonth
    CHECK (OpenEndMonth IS NULL OR (OpenEndMonth BETWEEN 1 AND 12));
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_UnitLegalCase_OpenEndPair' AND parent_object_id = OBJECT_ID(N'dbo.UnitLegalCase')
)
BEGIN
  ALTER TABLE dbo.UnitLegalCase
    ADD CONSTRAINT CK_UnitLegalCase_OpenEndPair
    CHECK (
      (OpenEndYear IS NULL AND OpenEndMonth IS NULL)
      OR (OpenEndYear IS NOT NULL AND OpenEndMonth IS NOT NULL)
    );
END
GO
