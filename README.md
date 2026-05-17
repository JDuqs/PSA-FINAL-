# PSA Gate Pass System - Security Guard Supplies Tracking ✅

## Quick Login
| Role | URL | Test Credentials |
|------|-----|------------------|
| **Security Guard** | `guardsupplies.html` | `guard1@test.com` / `guard123` |
| **Staff** | `index.html` | Your account |
| **Admin** | `admin.html` | `admin@psa.gov.ph` |

## Guard Features
```
1. Login → Green dashboard
2. "OUT Items" → Live gate passes OUT
3. "Process Returns" → Scan ID + PDF → RETURNED
4. Real-time stats/clock
5. Search/filter overdue
```

## Setup Real Guards
```
1. signup.html → "Security Guard" department
2. admin.html → APPROVE → role='guard'
3. guardsupplies.html → Works!
```

## Debug (F12 Console)
```
"🛡️ Guard session validated" = SUCCESS
"Guard Dashboard Active" = DASHBOARD LOADED
```

## Files Added
```
guardsupplies.html (login)
guard-dashboard.html (dashboard) 
guard-app.js (logic)
+ auth/data/render integrated
```

**Fully working** - Test now!

## Station Admin Provisioning
Station admin creation is now designed to run through a Supabase Edge Function instead of browser-side `signUp()`.

Files:
- `supabase/functions/manage-station-admin/index.ts`
- `supabase/config.toml`

Deploy:
```bash
supabase functions deploy manage-station-admin
```

Required function env vars:
```bash
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

What it does:
1. Verifies the caller is `admin@psa.gov.ph`
2. Creates or updates the station admin in `auth.users`
3. Inserts or updates the matching row in `public.users`
4. Replaces the old station admin automatically for Property, Inspection, or OIC

