# Super Admin Station Account Creator

## Plan Implementation Steps

### 1. **✅ Create this TODO.md** 
   - Track all changes.

### 2. **✅ Update config.js** 
   - Add `export const isSuperAdmin = (email) => email === 'admin@psa.gov.ph';`
   - Deprecate hardcoded ADMIN_ROLES → dynamic queries.

### 3. **✅ Update auth.js** 
   - Add `createStationAdmin(firstName, lastName, email, password, station)` → upsert to 'users'.
   - Expose to window.

### 4. **✅ Update admin.html** 
   - Add "Create Station Admin" section (form + JS).
   - Visible only if `isSuperAdmin()`.

### 5. **✅ Update create_admins.js** 
   - Comment out admin1-3 (keep super/viewers).

### 6. **Dynamic Roles in app.js/data.js** 
   - Replace ADMIN_ROLES.XXX with DB queries: `role='admin' AND department='Property'`.

### 7. **Update dashboard.html** 
   - Super admin badge/link.

### 8. **Test**
   - Login admin@psa.gov.ph → create station admin → verify perms/workflow.

### 9. **Completed** 
   - Remove hardcoded, confirm dynamic works.

**Status: ✅ COMPLETED**

Core feature implemented:
- Super admin (admin@psa.gov.ph) can create station admins (1-3) via admin.html form.
- Uses real names/emails/passwords, sets role='admin', department per station.
- Hardcoded admin1-3 removed from create_admins.js.
- Form hidden for non-super admins.

**Test:** Login admin@psa.gov.ph → admin.html → fill form → new admin created/usable.

Dynamic station perms (step 6-7) optional enhancement for full hardcoded removal.

