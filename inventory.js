// Inventory, Cart, and Lookup Logic
import { supabase, ADMIN_ROLES, canManageFiles, isSuperAdmin } from './config.js';
import { state } from './state.js';
import { showConfirm } from './utils.js';

console.log("✅ PSA INVENTORY MODULE ACTIVE - V11 (Unlimited Loading & Search Priority)");

// Local state for cart pagination
let cartPagination = {
    page: 1,
    limit: 10
};

/**
 * Unified Category Detection based on keywords in description
 * Checks for explicit [Category] prefix tag first, then falls back to keyword matching
 */
export function detectItemCategory(description) {
    const d = (description || "");
    // Check for explicit category tag set during import
    const tagMatch = d.match(/^\[([^\]]+)\]/);
    if (tagMatch) {
        const tag = tagMatch[1].trim();
        const valid = ['Tablets', 'Laptops', 'Desktops', 'Monitors', 'Peripherals', 'Others'];
        if (valid.includes(tag)) return tag;
    }
    const dl = d.toLowerCase();
    if (dl.includes('tablet') || dl.includes('ipad') || dl.includes('galaxy tab') || dl.includes('lenovo tab') || dl.includes(' tab ')) return 'Tablets';
    if (dl.includes('laptop') || dl.includes('macbook') || dl.includes('notebook') || dl.includes('thinkpad') || dl.includes('latitude') || dl.includes('elitebook') || dl.includes('probook') || dl.includes('chromebook')) return 'Laptops';
    if (dl.includes('desktop') || dl.includes('system unit') || dl.includes('cpu') || dl.includes('mac mini') || dl.includes('imac') || dl.includes('workstation') || dl.includes('optiplex') || dl.includes('all-in-one') || dl.includes('aio')) return 'Desktops';
    if (dl.includes('monitor') || dl.includes('display') || dl.includes('screen') || dl.includes('led monitor') || dl.includes('lcd monitor')) return 'Monitors';
    if (dl.includes('printer') || dl.includes('scanner') || dl.includes('projector') || dl.includes('keyboard') || dl.includes('mouse') || dl.includes('router') || dl.includes('switch') || dl.includes('webcam')) return 'Peripherals';
    return 'Others';
}

/**
 * Helper to fetch ALL records from a table using recursive pagination
 * This bypasses the 1000-row limit in Supabase.
 */
export async function fetchAllRecords(tableName, select = '*') { // Exported for guard-app.js
    let allData = [];
    let from = 0;
    const pageSize = 1000;
    let fetching = true;

    while (fetching) {
        const { data, error } = await supabase.from(tableName)
            .select(select)
            .order('id', { ascending: true, nullsFirst: false }) // Robust: 'id' always exists, fallback from 'serial'
            .range(from, from + pageSize - 1);
        
        if (error) {
            console.error(`Supabase Error in fetchAllRecords (${tableName}):`, error);
            throw new Error(`${error.code}: ${error.message}`);
        }
        
        if (!data || data.length === 0) {
            fetching = false;
        } else {
            allData = allData.concat(data);
            if (data.length < pageSize) {
                fetching = false;
            } else {
                from += pageSize;
            }
        }
    }
    return allData;
}

/**
 * Syncs the local state with currently borrowed or pending serials from DB
 */
export async function updateBorrowedStatus() {
    try {
        const allBorrowed = await fetchAllRecords('gate_passes', 'serial, status');
        const activeStatuses = ['OUT', 'RELEASING', 'PENDING_PROPERTY', 'PENDING_INSPECTION', 'PENDING_OIC'];
        
        state.borrowedSerials = new Set(
            allBorrowed
                .filter(d => d && d.serial && activeStatuses.includes(d.status))
                .map(d => String(d.serial).trim())
        );
    } catch(e) {
        console.error("Error updating borrowed status:", e);
    }
}

/**
 * Calculates and updates counts for category filters
 */
export async function loadInventoryStats() {
    await updateBorrowedStatus();
    try {
        const allItems = await fetchAllRecords('inventory', 'description, serial');
        
        if (allItems.length === 0) return;

        const availableItems = allItems.filter(item => {
            const serial = String(item.serial || '').trim();
            return serial && !state.borrowedSerials.has(serial) && !state.cart.some(c => String(c.serial).trim() === serial);
        });

        const counts = { 'All': availableItems.length, 'Tablets': 0, 'Laptops': 0, 'Desktops': 0, 'Monitors': 0, 'Peripherals': 0 };
        availableItems.forEach(item => {
            const cat = detectItemCategory(item.description);
            if (counts.hasOwnProperty(cat)) counts[cat]++;
        });

        const select = document.getElementById('inventoryCategoryFilter');
        if (select) {
            const labels = { 'All': 'All Categories', 'Tablets': 'Tablets', 'Laptops': 'Laptops', 'Desktops': 'Desktops & CPUs', 'Monitors': 'Monitors', 'Peripherals': 'Peripherals' };
            Array.from(select.options).forEach(opt => {
                const baseLabel = labels[opt.value];
                if (baseLabel) {
                    const count = counts[opt.value] || 0;
                    opt.text = `${baseLabel} (${count})`;
                }
            });
        }
    } catch(e) {
        console.error("Error loading inventory stats:", e);
    }
}

/**
 * Renders the search table with grouping, sticky headers, and icons
 * SEARCH PRIORITY: Text search ignores categories to find exact matches.
 */
export async function renderInventoryLookupTable(filterTerm) {
    const tbody = document.getElementById('inventoryLookupBody');
    if (!tbody) return;

    const mainSerialInput = document.getElementById('serial');
    const searchInput = document.getElementById('inventorySearchInput');
    
    // Carry over text from dashboard input to modal
    if (filterTerm === '' && mainSerialInput && mainSerialInput.value.trim() !== '') {
        filterTerm = mainSerialInput.value.trim();
        if (searchInput) searchInput.value = filterTerm;
    }

    const categoryVal = document.getElementById('inventoryCategoryFilter')?.value || 'All';
    clearTimeout(state.searchDebounceTimer);

    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Searching...</td></tr>';

    state.searchDebounceTimer = setTimeout(async () => {
        try {
            await updateBorrowedStatus();
            
            let inventoryData = [];

            // If user types text, search the WHOLE database first
            if (filterTerm) {
                const term = `%${filterTerm}%`;
                const { data, error } = await supabase.from('inventory')
                    .select('*')
                    .or(`serial.ilike.${term},description.ilike.${term},asset_no.ilike.${term}`)
                    .order('serial', { ascending: true });
                
                if (error) throw error;
                inventoryData = data || [];
                
                // If there's more than 1000 matches, we may need to recursively fetch, 
                // but usually text search narrows results down enough.
            } else {
                // If browsing (empty search), use recursion for all records
                inventoryData = await fetchAllRecords('inventory');
                
                // Then filter by category client-side
                if (categoryVal !== 'All') {
                    inventoryData = inventoryData.filter(i => detectItemCategory(i.description) === categoryVal);
                }
            }

            // Filter for strictly available items
            const availableItems = inventoryData.filter(i => {
                const serial = String(i.serial || '').trim();
                return serial && !state.borrowedSerials.has(serial) && !state.cart.some(c => String(c.serial).trim() === serial);
            });

            state.currentSearchResults = availableItems;
            tbody.innerHTML = '';

            if (availableItems.length === 0) {
                const msg = filterTerm ? `No matches found for "${filterTerm}"` : "No items found in this category.";
                tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4"><strong>${msg}</strong></td></tr>`;
                return;
            }

            // Sort logic
            availableItems.sort((a, b) => {
                const catA = detectItemCategory(a.description);
                const catB = detectItemCategory(b.description);
                const catOrder = { 'Tablets': 1, 'Laptops': 2, 'Desktops': 3, 'Monitors': 4, 'Peripherals': 5, 'Others': 6 };
                if (catOrder[catA] !== catOrder[catB]) return (catOrder[catA] || 99) - (catOrder[catB] || 99);
                return String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true });
            });

            const getCategoryIcon = (cat) => {
                const map = { 'Tablets': 'fa-tablet-screen-button', 'Laptops': 'fa-laptop', 'Desktops': 'fa-computer', 'Monitors': 'fa-display', 'Peripherals': 'fa-print', 'Others': 'fa-box-open' };
                return map[cat] || 'fa-box';
            };

            // Build UI in memory
            let htmlBuffer = "";
            let lastCategory = "";
    const displayLimit = 50000; // Future-proof for 50k+ items
    const itemsToRender = availableItems.slice(0, displayLimit);

            itemsToRender.forEach(item => {
                const currentCategory = detectItemCategory(item.description); 
                if (currentCategory !== lastCategory) {
                    let displayCat = currentCategory === 'Desktops' ? 'Desktops & CPUs' : currentCategory;
                    htmlBuffer += `
                        <tr class="table-light border-bottom border-2 sticky-top" style="top: 0; z-index: 1;">
                            <td colspan="4" class="fw-bold text-primary small text-uppercase px-3 py-2 bg-light shadow-sm">
                                <i class="fa ${getCategoryIcon(currentCategory)} me-2"></i>${displayCat}
                            </td>
                        </tr>`;
                    lastCategory = currentCategory;
                }
                
                const serial = String(item.serial || '');
                const safeSerial = serial.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const desc = String(item.description || '');
                const displayAsset = item.asset_no || '<span class="text-muted opacity-50">N/A</span>';

                htmlBuffer += `
                    <tr style="cursor: pointer;" onclick="window.selectInventoryItem('${safeSerial}')" class="align-middle">
                        <td class="ps-4">
                            <div class="d-flex align-items-center">
                                <div class="bg-light rounded p-2 me-3 text-secondary border d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
                                    <i class="fa ${getCategoryIcon(currentCategory)} fa-lg"></i>
                                </div>
                                <div>
                                    <div class="fw-bold text-dark font-monospace text-nowrap">${serial}</div>
                                    <div class="small text-muted d-md-none text-truncate" style="max-width: 150px;">${desc}</div>
                                </div>
                            </div>
                        </td>
                        <td class="d-none d-md-table-cell w-50"><small class="fw-semibold text-secondary text-wrap">${desc}</small></td>
                        <td><span class="badge bg-white text-secondary border shadow-sm">${displayAsset}</span></td>
                        <td class="text-end pe-3"><button class="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold">Select <i class="fa fa-arrow-right ms-1"></i></button></td>
                    </tr>`;
            });

            if (availableItems.length > displayLimit) {
                htmlBuffer += `<tr><td colspan="4" class="text-center py-3 bg-light text-muted small">Showing top ${displayLimit} matches. Use search to narrow results.</td></tr>`;
            }

            tbody.innerHTML = htmlBuffer;

        } catch (err) {
            console.error("Critical Inventory Load Error:", err);
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4">Error loading data.</td></tr>`;
        }
    }, 400);
}

export function selectInventoryItem(serial) {
    const item = state.currentSearchResults.find(i => String(i.serial).trim() === String(serial).trim());
    
    if (item) {
        const serialEl = document.getElementById('serial');
        const descEl = document.getElementById('desc');
        const assetEl = document.getElementById('asset');
        const propEl = document.getElementById('propertyNum');

        if (serialEl) serialEl.value = item.serial || '';
        if (descEl) descEl.value = item.description || '';
        if (assetEl) assetEl.value = item.asset_no || '';
        if (propEl) propEl.value = item.property_no || '';

        const modalEl = document.getElementById('inventoryLookupModal');
        if (modalEl && window.bootstrap) {
            const modal = window.bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }
    }
}

/**
 * Bulk Add items prioritizing lowest Asset Numbers
 */
export async function handleBulkAdd() {
    const category = document.getElementById('bulkCategorySelect').value;
    const brand = document.getElementById('bulkBrandInput').value.trim();
    const qtyInput = document.getElementById('bulkQtyInput');
    const msgEl = document.getElementById('bulkStatusMsg');
    const qty = parseInt(qtyInput.value);

    if (!category && !brand) return alert("Please select a Category OR type a specific Brand.");
    if (!qty || qty < 1) return alert("Please enter a valid quantity.");
    
    msgEl.innerText = "Analyzing full inventory records...";
    msgEl.className = "small text-primary mt-1 fw-bold";
    
    const btn = document.getElementById('btnBulkAdd');
    btn.disabled = true; 

    try {
        await updateBorrowedStatus();
        
        let inventoryData = [];
        if (brand) {
            const term = `%${brand}%`;
            const { data, error } = await supabase.from('inventory').select('*').ilike('description', term);
            if (error) throw error;
            inventoryData = data || [];
        } else {
            inventoryData = await fetchAllRecords('inventory');
        }

        if (category) {
            inventoryData = inventoryData.filter(i => detectItemCategory(i.description) === category);
        }

        const available = inventoryData.filter(i => {
            const serial = String(i.serial || '').trim();
            return serial && !state.borrowedSerials.has(serial) && !state.cart.some(c => String(c.serial).trim() === serial);
        });

        available.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

        if (available.length === 0) {
            msgEl.innerText = "No available items found matching filters.";
            msgEl.className = "small text-danger mt-1 fw-bold";
            return;
        }

        const toAdd = available.slice(0, qty);
        toAdd.forEach(item => {
            state.cart.push({ 
                serial: String(item.serial || ''), 
                property_no: String(item.property_no || ''), 
                desc: String(item.description || ''), 
                asset: String(item.asset_no || '') 
            });
        });

        renderCart();
        msgEl.innerText = `Successfully added ${toAdd.length} items!`;
        msgEl.className = "small text-success mt-1 fw-bold";
        qtyInput.value = 1;
        loadInventoryStats(); 

    } catch (e) {
        msgEl.innerText = "Error: " + e.message;
        msgEl.className = "small text-danger mt-1";
    } finally {
        btn.disabled = false;
    }
}

/**
 * Renders the checkout cart with pagination and "Clear All" logic
 */
export function renderCart() {
    const tbody = document.getElementById('cartTableBody');
    if (!tbody) return;
    
    state.cart.sort((a, b) => String(a.asset || '').localeCompare(String(b.asset || ''), undefined, { numeric: true }));

    const totalItems = state.cart.length;
    const totalPages = Math.ceil(totalItems / cartPagination.limit) || 1;
    if (cartPagination.page > totalPages) cartPagination.page = totalPages;
    if (cartPagination.page < 1) cartPagination.page = 1;

    const start = (cartPagination.page - 1) * cartPagination.limit;
    const pageItems = state.cart.slice(start, start + cartPagination.limit);

    tbody.innerHTML = totalItems === 0 ? '<tr><td colspan="5" class="text-center text-muted py-3">Cart is empty</td></tr>' : "";
    
    pageItems.forEach((item, index) => {
        const realIndex = start + index;
        tbody.innerHTML += `
            <tr class="align-middle">
                <td><span class="font-monospace fw-bold">${item.serial}</span></td>
                <td>${item.property_no||'-'}</td>
                <td class="small fw-semibold text-secondary">${item.desc}</td>
                <td><span class="badge bg-light text-dark border">${item.asset}</span></td>
                <td class="text-center"><button onclick="window.removeItem(${realIndex})" class="btn btn-sm btn-outline-danger py-0 border-0"><i class="fa fa-times"></i></button></td>
            </tr>`;
    });

    renderCartPaginationControls(tbody.closest('table'), totalItems, totalPages);
    
    const issueBtn = document.getElementById('issueBtn');
    if(issueBtn) issueBtn.disabled = totalItems === 0;
}

function renderCartPaginationControls(tableEl, totalItems, totalPages) {
    if (!tableEl) return;
    let controls = document.getElementById('cartPaginationControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'cartPaginationControls';
        controls.className = 'd-flex justify-content-between align-items-center mt-2 p-2 bg-light border rounded shadow-sm small';
        tableEl.after(controls);
    }
    
    if (totalItems === 0) { controls.style.display = 'none'; return; }
    controls.style.display = 'flex';

    controls.innerHTML = `
        <div class="d-flex align-items-center gap-2">
            <label class="fw-bold text-secondary">Show:</label>
            <select class="form-select form-select-sm py-0" style="width: auto;" onchange="window.setCartLimit(this.value)">
                <option value="10" ${cartPagination.limit == 10 ? 'selected' : ''}>10</option>
                <option value="25" ${cartPagination.limit == 25 ? 'selected' : ''}>25</option>
                <option value="50" ${cartPagination.limit == 50 ? 'selected' : ''}>50</option>
                <option value="100" ${cartPagination.limit == 100 ? 'selected' : ''}>100</option>
            </select>
            <span class="text-muted ms-2">Total: ${totalItems}</span>
            <button class="btn btn-sm btn-outline-danger ms-3 py-0" onclick="window.clearCart()" title="Remove all items"><i class="fa fa-trash-can me-1"></i> Clear All</button>
        </div>
        <div class="d-flex align-items-center">
            <button class="btn btn-sm btn-light border py-0" onclick="window.changeCartPage(-1)" ${cartPagination.page === 1 ? 'disabled' : ''}><i class="fa fa-chevron-left"></i></button>
            <span class="mx-3 fw-bold text-dark">Page ${cartPagination.page} of ${totalPages}</span>
            <button class="btn btn-sm btn-light border py-0" onclick="window.changeCartPage(1)" ${cartPagination.page === totalPages ? 'disabled' : ''}><i class="fa fa-chevron-right"></i></button>
        </div>
    `;
}

// ==========================================
// EXPORTED CONTROLS
// ==========================================
export function setCartLimit(val) { 
    cartPagination.limit = parseInt(val); 
    cartPagination.page = 1; 
    renderCart(); 
}

export function changeCartPage(delta) { 
    cartPagination.page += delta; 
    renderCart(); 
}

export async function clearCart() {
    if (state.cart.length === 0) return;
    if (await showConfirm("Clear Cart", "Are you sure you want to remove all items from the cart?")) {
        state.cart = [];
        renderCart();
    }
}

export function removeItem(i) { 
    state.cart.splice(i, 1); 
    renderCart(); 
}

// ==========================================
// MASTER INVENTORY LOGIC (ADMIN VIEW)
// ==========================================
// Cached data for client-side filtering
let _psaInventoryCache = [];
let _philsysInventoryCache = [];

export async function loadMasterInventory() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return; 
    
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Downloading all records...</td></tr>';
    
    try {
        await updateBorrowedStatus();
        const inventoryData = await fetchAllRecords('inventory');
        
        if (!inventoryData || inventoryData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">0 items found.</td></tr>`;
            return;
        }

        _psaInventoryCache = inventoryData.filter(i => i.serial);
        _psaInventoryCache.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

        // --- AVAILABLE STOCKS SUMMARY CARDS ---
        const categoryOrder = ['Tablets', 'Laptops', 'Desktops', 'Monitors', 'Peripherals', 'Others'];
        const catTotals = {}, catAvailable = {};
        _psaInventoryCache.forEach(item => {
            const cat = detectItemCategory(item.description);
            catTotals[cat] = (catTotals[cat] || 0) + 1;
            if (!state.borrowedSerials?.has(String(item.serial).trim()))
                catAvailable[cat] = (catAvailable[cat] || 0) + 1;
        });
        const summaryEl = document.getElementById('inventoryStockSummary');
        if (summaryEl) {
            const catColors = { Tablets: 'primary', Laptops: 'info', Desktops: 'secondary', Monitors: 'warning', Peripherals: 'success', Others: 'dark' };
            summaryEl.innerHTML = categoryOrder.filter(c => catTotals[c]).map(cat => {
                const avail = catAvailable[cat] || 0, total = catTotals[cat] || 0;
                const color = catColors[cat] || 'secondary';
                return `<div class="col-6 col-md-4 col-lg-2">
                    <div class="card border-${color} shadow-sm text-center py-2 px-1" style="cursor:pointer;" onclick="document.getElementById('psaInvCategoryFilter').value='${cat}';window._renderPsaInventoryTable()">
                        <div class="fw-bold text-${color}" style="font-size:1.4rem;">${avail}</div>
                        <div class="small text-muted">/ ${total} total</div>
                        <div class="small fw-bold text-truncate">${cat}</div>
                    </div>
                </div>`;
            }).join('');
        }

        // Show/hide the Action column header based on role
        const deleteHeader = document.getElementById('invDeleteHeader');
        if (deleteHeader) deleteHeader.style.display = isSuperAdmin(state.currentUser) ? '' : 'none';

        // Wire up filters (only once)
        const searchEl = document.getElementById('psaInvSearch');
        const catEl = document.getElementById('psaInvCategoryFilter');
        const statusEl = document.getElementById('psaInvStatusFilter');
        if (searchEl && !searchEl.dataset.wired) {
            searchEl.dataset.wired = '1';
            searchEl.addEventListener('input', window._renderPsaInventoryTable);
            catEl?.addEventListener('change', window._renderPsaInventoryTable);
            statusEl?.addEventListener('change', window._renderPsaInventoryTable);
        }

        window._renderPsaInventoryTable();

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${err.message}</td></tr>`;
    }
}

window._renderPsaInventoryTable = function() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    const search = (document.getElementById('psaInvSearch')?.value || '').toLowerCase();
    const cat = document.getElementById('psaInvCategoryFilter')?.value || 'all';
    const status = document.getElementById('psaInvStatusFilter')?.value || 'all';
    const canDelete = isSuperAdmin(state.currentUser);

    const filtered = _psaInventoryCache.filter(item => {
        const isOut = state.borrowedSerials?.has(String(item.serial).trim());
        if (status === 'available' && isOut) return false;
        if (status === 'out' && !isOut) return false;
        if (cat !== 'all' && detectItemCategory(item.description) !== cat) return false;
        if (search) {
            const haystack = `${item.serial} ${item.description} ${item.asset_no} ${item.property_no}`.toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${canDelete ? 6 : 5}" class="text-center text-muted py-4">No items match the current filters.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(item => {
        const isOut = state.borrowedSerials?.has(String(item.serial).trim());
        const badge = isOut ? '<span class="badge bg-danger">OUT</span>' : '<span class="badge bg-success">AVAILABLE</span>';
        const deleteBtn = canDelete && !isOut
            ? `<td class="text-center"><button class="btn btn-outline-danger btn-sm py-0" onclick="window.deleteInventoryItem('${item.id}','${encodeURIComponent(item.serial)}')"><i class="fa fa-trash"></i></button></td>`
            : canDelete ? `<td class="text-center"><span class="text-muted small" title="Cannot delete — item is currently OUT">—</span></td>` : '';
        html += `<tr class="align-middle">
            <td class="font-monospace fw-bold">${item.serial}</td>
            <td>${item.property_no || '-'}</td>
            <td class="small">${item.description || '-'}</td>
            <td class="text-center"><span class="badge bg-light text-dark border">${item.asset_no || '-'}</span></td>
            <td class="text-center">${badge}</td>
            ${deleteBtn}
        </tr>`;
    });
    tbody.innerHTML = html;
};

window.deleteInventoryItem = async function(itemId, encodedSerial) {
    const serial = decodeURIComponent(encodedSerial);
    if (!isSuperAdmin(state.currentUser)) return alert("Unauthorized: Only the Super Admin can delete inventory items.");

    // Safety: block deletion if item is currently out
    if (state.borrowedSerials?.has(serial.trim())) {
        return alert(`Cannot delete "${serial}" — this item is currently OUT on an active gate pass.`);
    }

    if (!await showConfirm("Delete Inventory Item", `Permanently delete "${serial}" from the master inventory?\n\nThis cannot be undone.`)) return;

    try {
        const { error } = await supabase.from('inventory').delete().eq('id', itemId);
        if (error) throw error;

        // Remove from local cache and re-render without full reload
        _psaInventoryCache = _psaInventoryCache.filter(i => i.id !== itemId);
        window._renderPsaInventoryTable();

        // Update summary cards
        const summaryEl = document.getElementById('inventoryStockSummary');
        if (summaryEl) {
            const categoryOrder = ['Tablets', 'Laptops', 'Desktops', 'Monitors', 'Peripherals', 'Others'];
            const catColors = { Tablets: 'primary', Laptops: 'info', Desktops: 'secondary', Monitors: 'warning', Peripherals: 'success', Others: 'dark' };
            const catTotals = {}, catAvailable = {};
            _psaInventoryCache.forEach(item => {
                const cat = detectItemCategory(item.description);
                catTotals[cat] = (catTotals[cat] || 0) + 1;
                if (!state.borrowedSerials?.has(String(item.serial).trim()))
                    catAvailable[cat] = (catAvailable[cat] || 0) + 1;
            });
            summaryEl.innerHTML = categoryOrder.filter(c => catTotals[c]).map(cat => {
                const avail = catAvailable[cat] || 0, total = catTotals[cat] || 0;
                const color = catColors[cat] || 'secondary';
                return `<div class="col-6 col-md-4 col-lg-2">
                    <div class="card border-${color} shadow-sm text-center py-2 px-1" style="cursor:pointer;" onclick="document.getElementById('psaInvCategoryFilter').value='${cat}';window._renderPsaInventoryTable()">
                        <div class="fw-bold text-${color}" style="font-size:1.4rem;">${avail}</div>
                        <div class="small text-muted">/ ${total} total</div>
                        <div class="small fw-bold text-truncate">${cat}</div>
                    </div>
                </div>`;
            }).join('');
        }
    } catch(e) { alert("Delete failed: " + e.message); }
};

export async function loadPhilSysInventoryTable() {
    const tbody = document.getElementById('philsysInvTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4"><div class="spinner-border text-success spinner-border-sm me-2"></div>Loading PhilSys kits...</td></tr>';

    try {
        // Get active kit serials from gate_passes
        const { data: activePasses } = await supabase.from('gate_passes')
            .select('serial')
            .in('status', ['PENDING_PROPERTY','PENDING_INSPECTION','PENDING_OIC','RELEASING','OUT']);
        const activeSerials = new Set((activePasses || []).map(p => String(p.serial).trim()));

        const { data, error } = await supabase.from('philsys_inventory').select('*').order('kit_serial', { ascending: true });
        if (error) throw error;

        _philsysInventoryCache = data || [];

        // Summary
        const total = _philsysInventoryCache.length;
        const available = _philsysInventoryCache.filter(k => !activeSerials.has(String(k.kit_serial).trim())).length;
        const summaryEl = document.getElementById('philsysStockSummary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="d-flex gap-3 flex-wrap">
                    <span class="badge bg-success fs-6 px-3 py-2"><i class="fa fa-check-circle me-1"></i>${available} Available</span>
                    <span class="badge bg-danger fs-6 px-3 py-2"><i class="fa fa-box-open me-1"></i>${total - available} Out</span>
                    <span class="badge bg-secondary fs-6 px-3 py-2"><i class="fa fa-database me-1"></i>${total} Total Kits</span>
                </div>`;
        }

        // Wire up filters (only once)
        const searchEl = document.getElementById('philsysInvSearch');
        const statusEl = document.getElementById('philsysInvStatusFilter');
        if (searchEl && !searchEl.dataset.wired) {
            searchEl.dataset.wired = '1';
            searchEl.addEventListener('input', () => window._renderPhilSysInventoryTable(activeSerials));
            statusEl?.addEventListener('change', () => window._renderPhilSysInventoryTable(activeSerials));
        }

        window._renderPhilSysInventoryTable(activeSerials);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger py-4">Error: ${err.message}</td></tr>`;
    }
}

window._renderPhilSysInventoryTable = function(activeSerials) {
    const tbody = document.getElementById('philsysInvTableBody');
    if (!tbody) return;
    const search = (document.getElementById('philsysInvSearch')?.value || '').toLowerCase();
    const status = document.getElementById('philsysInvStatusFilter')?.value || 'all';

    const filtered = _philsysInventoryCache.filter(kit => {
        const isOut = activeSerials?.has(String(kit.kit_serial).trim());
        if (status === 'available' && isOut) return false;
        if (status === 'out' && !isOut) return false;
        if (search) {
            const haystack = Object.values(kit).join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No kits match the current filters.</td></tr>';
        return;
    }

    const na = (v) => v || '<span class="text-muted">—</span>';
    tbody.innerHTML = filtered.map(kit => {
        const isOut = activeSerials?.has(String(kit.kit_serial).trim());
        const badge = isOut ? '<span class="badge bg-danger">OUT</span>' : '<span class="badge bg-success">AVAILABLE</span>';
        return `<tr class="align-middle">
            <td class="fw-bold font-monospace">${na(kit.kit_serial)}</td>
            <td class="small">${na(kit.laptop_model)}</td>
            <td class="small font-monospace">${na(kit.laptop_sn)}</td>
            <td class="small font-monospace">${na(kit.scanner_sn)}</td>
            <td class="small font-monospace">${na(kit.iris_sn)}</td>
            <td class="small font-monospace">${na(kit.webcam_sn)}</td>
            <td class="small font-monospace">${na(kit.doc_scanner_sn)}</td>
            <td class="small font-monospace">${na(kit.monitor_sn)}</td>
            <td class="small font-monospace">${na(kit.printer_sn)}</td>
            <td class="text-center">${badge}</td>
        </tr>`;
    }).join('');
};

// ==========================================
// PHILSYS OTHER INVENTORY (philsyskit_other_inventory table)
// ==========================================
let _philsysOtherCache = [];

window.loadPhilSysOtherInventory = async function() {
    const tbody = document.getElementById('philsysOtherInvTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner-border text-success spinner-border-sm me-2"></div>Loading...</td></tr>';

    try {
        // Get active serials to show OUT status
        const { data: activePasses } = await supabase.from('gate_passes')
            .select('serial')
            .in('status', ['PENDING_PROPERTY','PENDING_INSPECTION','PENDING_OIC','RELEASING','OUT']);
        const activeSerials = new Set((activePasses || []).map(p => String(p.serial).trim()));

        const { data, error } = await supabase
            .from('philsyskit_other_inventory')
            .select('*')
            .order('serial', { ascending: true });
        if (error) throw error;

        _philsysOtherCache = data || [];

        // Show/hide delete column for super admin
        const delHeader = document.getElementById('philsysOtherDeleteHeader');
        if (delHeader) delHeader.style.display = isSuperAdmin(state.currentUser) ? '' : 'none';

        // Wire search (only once)
        const searchEl = document.getElementById('philsysOtherSearch');
        if (searchEl && !searchEl.dataset.wired) {
            searchEl.dataset.wired = '1';
            searchEl.addEventListener('input', () => window._renderPhilSysOtherTable(activeSerials));
        }

        window._renderPhilSysOtherTable(activeSerials);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error: ${e.message}</td></tr>`;
    }
};

window._renderPhilSysOtherTable = function(activeSerials) {
    const tbody = document.getElementById('philsysOtherInvTableBody');
    if (!tbody) return;
    const search = (document.getElementById('philsysOtherSearch')?.value || '').toLowerCase();
    const canDelete = isSuperAdmin(state.currentUser);

    const filtered = _philsysOtherCache.filter(item => {
        if (!search) return true;
        return `${item.serial} ${item.description} ${item.asset_no} ${item.property_no}`.toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No items found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const isOut = activeSerials?.has(String(item.serial).trim());
        const badge = isOut ? '<span class="badge bg-danger">OUT</span>' : '<span class="badge bg-success">AVAILABLE</span>';
        const deleteBtn = canDelete
            ? `<td class="text-center"><button class="btn btn-outline-danger btn-sm py-0" onclick="window.deletePhilSysOtherItem('${item.id}','${encodeURIComponent(item.serial)}')"><i class="fa fa-trash"></i></button></td>`
            : '';
        return `<tr class="align-middle">
            <td class="font-monospace fw-bold">${item.serial || ''}</td>
            <td>${item.property_no || '—'}</td>
            <td class="small">${item.description || '—'}</td>
            <td class="text-center"><span class="badge bg-light text-dark border">${item.asset_no || '—'}</span></td>
            <td class="text-center">${badge}</td>
            ${deleteBtn}
        </tr>`;
    }).join('');
};

window.deletePhilSysOtherItem = async function(itemId, encodedSerial) {
    const serial = decodeURIComponent(encodedSerial);
    if (!isSuperAdmin(state.currentUser)) return alert("Unauthorized.");
    if (!await showConfirm("Delete Item", `Permanently delete "${serial}" from PhilSys Other Inventory?\n\nThis cannot be undone.`)) return;
    try {
        const { error } = await supabase.from('philsyskit_other_inventory').delete().eq('id', itemId);
        if (error) throw error;
        _philsysOtherCache = _philsysOtherCache.filter(i => String(i.id) !== String(itemId));
        // Re-render with the last known activeSerials — just re-call loadPhilSysOtherInventory to be safe
        window.loadPhilSysOtherInventory();
    } catch(e) { alert("Delete failed: " + e.message); }
};

export async function exportMasterInventoryExcel() {
    const btn = document.getElementById('exportInventoryBtn');
    const originalHtml = btn?.innerHTML;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i>DOWNLOADING...';
    }

    try {
        const inventoryData = await fetchAllRecords('inventory');
        const rows = (inventoryData || [])
            .filter(item => item.serial)
            .map(item => ({
                serial_no: item.serial || '',
                property_no: item.property_no || '',
                description: item.description || '',
                asset_no: item.asset_no || ''
            }));

        if (rows.length === 0) {
            alert('No data found in PSA Inventory.');
            return;
        }

        rows.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

        const ws = window.XLSX.utils.json_to_sheet(rows);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'PSA_Inventory');
        window.XLSX.writeFile(wb, 'PSA_Master_Inventory.xlsx');
    } catch (err) {
        alert('Export error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml || '<i class="fa fa-file-excel me-2"></i> DOWNLOAD PSA INVENTORY TO EXCEL';
        }
    }
}

// ==========================================
// EXCEL IMPORT HANDLING
// ==========================================
export async function processImportFile() {
    const fileEl = document.getElementById('inventoryFile') || document.getElementById('bulkFile');
    if (!fileEl || !fileEl.files[0]) return alert("Select a file first.");
    const file = fileEl.files[0];
    
    const btn = document.getElementById('processImportBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i>Processing...';
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = window.XLSX.read(data, { type: 'array' });
            const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            state.tempImportData = jsonData;
            renderImportPreview(jsonData);
            
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Process File';
            }
            const saveBtn = document.getElementById('saveBulkBtn');
            if (saveBtn) saveBtn.style.display = 'block';
            
        } catch (err) {
            alert("Excel Error: " + err.message);
            if (btn) btn.disabled = false;
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderImportPreview(data) {
    const tbody = document.getElementById('importBody') || document.getElementById('importPreviewBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const previewDiv = document.getElementById('importPreview');
    if(previewDiv) previewDiv.style.display = 'block';

    const selectedCat = document.getElementById('importCategorySelect')?.value || '';

    let htmlBuffer = "";
    data.slice(0, 10).forEach(row => {
        const serial = String(row.serial || row.Serial || row['Serial No.'] || row['Serial Number'] || '');
        const desc = String(row.description || row.Description || row.desc || '');
        const asset = String(row.asset_no || row['Asset No'] || row['Asset Tag'] || row.asset || '');
        const prop = String(row.property_no || row['Property No'] || row['Property No.'] || '');
        const cat = selectedCat || detectItemCategory(desc);
        const catBadge = `<span class="badge bg-primary">${cat}</span>`;
        
        htmlBuffer += `<tr><td>${serial}</td><td>${prop}</td><td>${desc}</td><td>${asset}</td><td>${catBadge}</td></tr>`;
    });
    if (data.length > 10) htmlBuffer += `<tr><td colspan="5" class="text-center text-muted small py-2 bg-light">...and ${data.length - 10} more items</td></tr>`;
    tbody.innerHTML = htmlBuffer;
}

export async function saveBulkImport() {
    if (!state.tempImportData || state.tempImportData.length === 0) return;
    const btn = document.getElementById('saveBulkBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Saving to DB...";
    }

    const selectedCat = document.getElementById('importCategorySelect')?.value || '';

    const formatted = state.tempImportData.map(row => {
        const rawDesc = String(row.description || row.Description || row.desc || '').trim();
        // Prefix with [Category] tag if user selected one, stripping any existing tag first
        const cleanDesc = rawDesc.replace(/^\[[^\]]+\]\s*/, '');
        const description = selectedCat ? `[${selectedCat}] ${cleanDesc}` : cleanDesc;
        return {
            serial: String(row.serial || row.Serial || row['Serial No.'] || row['Serial Number'] || '').trim(),
            property_no: String(row.property_no || row['Property No'] || row['Property No.'] || '').trim(),
            description,
            asset_no: String(row.asset_no || row['Asset No'] || row['Asset Tag'] || row.asset || '').trim()
        };
    }).filter(r => r.serial);

    if (formatted.length === 0) {
        alert("Upload Error: Could not find valid Serial Numbers.");
        if (btn) { btn.disabled = false; btn.innerText = "Save to Database"; }
        return;
    }

    try {
        const { error } = await supabase.from('inventory').upsert(formatted, { onConflict: 'serial' });
        if (error) throw error;

        alert(`Successfully synced ${formatted.length} items to database.`);
        
        const modalEl = document.getElementById('bulkImportModal');
        if (modalEl && window.bootstrap) {
            const modal = window.bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }
        
        const previewDiv = document.getElementById('importPreview');
        if (previewDiv) previewDiv.style.display = 'none';
        if (btn) btn.style.display = 'none';
        state.tempImportData = [];
        
        loadInventoryStats();
        loadMasterInventory(); 
    } catch (e) { 
        alert("Import Error: " + e.message); 
    } finally { 
        if (btn) {
            btn.disabled = false; 
            btn.innerHTML = '<i class="fa fa-upload me-2"></i> SAVE TO PSA MASTER INVENTORY'; 
        }
    }
}

// Mapping to window
window.setCartLimit = setCartLimit;
window.changeCartPage = changeCartPage;
window.clearCart = clearCart;
window.removeItem = removeItem;
window.selectInventoryItem = selectInventoryItem;
window.loadMasterInventory = loadMasterInventory;
window.exportMasterInventoryExcel = exportMasterInventoryExcel;
window.detectItemCategory = detectItemCategory;
