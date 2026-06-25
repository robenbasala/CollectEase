-- Per-user unit detail column visibility/order (Property details table).
IF OBJECT_ID(N'dbo.UserUnitDetailColumnPrefs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserUnitDetailColumnPrefs (
    FirebaseUid NVARCHAR(128) NOT NULL,
    PrefsJson NVARCHAR(MAX) NOT NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_UserUnitDetailColumnPrefs_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserUnitDetailColumnPrefs PRIMARY KEY (FirebaseUid)
  );
END
