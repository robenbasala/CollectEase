-- DEPRECATED: App users use Firebase Auth custom claims, not SQL.
-- Use Firebase Console / your admin API to change roles, or set CT_SUPER_ADMIN_EMAILS for bootstrap.
-- Promote an existing AppUser to admin by email (legacy SQL schema only).
-- Run against the same database as the Collection Tracker API.
--
-- company_admin = full access within that user's CompanyId (regions, properties, invites, settings).
-- super_admin   = can switch companies in the UI, create companies, manage users per company.
--
-- company_admin: full access within that user's CompanyId. super_admin: all companies + create company.
DECLARE @TargetRole NVARCHAR(32) = N'company_admin';
-- DECLARE @TargetRole NVARCHAR(32) = N'super_admin';

DECLARE @Email NVARCHAR(320) = N'developer@collectease360.com';

-- Optional: remove member-only property rows (not used once user is admin)
DELETE upa
FROM dbo.UserPropertyAccess AS upa
INNER JOIN dbo.AppUser AS u ON u.Id = upa.AppUserId
WHERE LOWER(LTRIM(RTRIM(u.Email))) = LOWER(LTRIM(RTRIM(@Email)));

UPDATE dbo.AppUser
SET Role = @TargetRole
WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@Email)));

-- Expect @@ROWCOUNT = 1. If 0, the user row does not exist yet (sign in once after invite, then rerun).
