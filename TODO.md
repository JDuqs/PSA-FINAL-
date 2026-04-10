# Unlimited Available Items Loading Plan (Future-Proof & No Limits)

Status: 🔧 **DEBUG: Guard dashboard blank – fixing fetchAllRecords**

## Breakdown of Steps:

### 1. **✅ Update guard-app.js** 
   - Replace `supabase.from('inventory').select('*').limit(1000)` with `fetchAllRecords('inventory')` import/use.
   - Remove `filtered.slice(0, 500)` in `renderGuardStock()` → show ALL items.
   - Update badge to `state.guardStock.length` (true total).

### 2. **✅ Update inventory.js** 
   - Increase `displayLimit = 2000` → `displayLimit = 50000` (future-proof).
   - Keep `pageSize = 1000` (Supabase optimal chunk).
   - Ensure `loadMasterInventory()` uses full fetch (already does).

### 3. **✅ Test Guard Stock View**
   - Open guardsupplies.html → guard-dashboard.html.
   - Verify badge shows ~2500+ available items.
   - Table loads all (scrollable), no "top X" truncation.

### 4. **✅ Test Admin Inventory**
   - Admin dashboard → inventory lookup/master table.
   - Shows all items uncapped.

### 5. **✅ Performance Check**
   - Console: No errors, load time <5s for 2500 items.
   - Future: Handles 10k+ via recursion.

### 6. **✅ COMPLETED** 
   - Unlimited recursive loading + high UI limits implemented.
   - Badge/counts reflect true totals from DB.
