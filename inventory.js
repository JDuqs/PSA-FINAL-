// Inventory, Cart, and Lookup Logic
import { supabase, ADMIN_ROLES } from './config.js';
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
 */
export function detectItemCategory(description) {
    const d = (description || "").toLowerCase();
    if (d.includes('tablet') || d.includes('ipad') || d.includes('galaxy tab') || d.includes('lenovo tab') || d.includes(' tab ')) return 'Tablets';
    if (d.includes('laptop') || d.includes('macbook') || d.includes('notebook') || d.includes('thinkpad') || d.includes('latitude') || d.includes('elitebook') || d.includes('probook') || d.includes('chromebook')) return 'Laptops';
    if (d.includes('desktop') || d.includes('system unit') || d.includes('cpu') || d.includes('mac mini') || d.includes('imac') || d.includes('workstation') || d.includes('optiplex') || d.includes('all-in-one') || d.includes('aio')) return 'Desktops';
    if (d.includes('monitor') || d.includes('display') || d.includes('screen') || d.includes('led monitor') || d.includes('lcd monitor')) return 'Monitors';
    if (d.includes('printer') || d.includes('scanner') || d.includes('projector') || d.includes('keyboard') || d.includes('mouse') || d.includes('router') || d.includes('switch') || d.includes('webcam')) return 'Peripherals';
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
export async function loadMasterInventory() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return; 
    
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Downloading all 5000+ records...</td></tr>';
    
    try {
        await updateBorrowedStatus();
        const inventoryData = await fetchAllRecords('inventory');
        
        tbody.innerHTML = '';
        if (!inventoryData || inventoryData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">0 items found.</td></tr>`;
            return;
        }

        const validItems = inventoryData.filter(i => i.serial);
        validItems.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));
        
        let htmlBuffer = "";
        validItems.forEach(item => {
            const serial = String(item.serial);
            const isOut = state.borrowedSerials && state.borrowedSerials.has(serial.trim());
            const statusBadge = isOut ? '<span class="badge bg-danger">OUT</span>' : '<span class="badge bg-success">AVAILABLE</span>';
            
            htmlBuffer += `
                <tr class="align-middle">
                    <td class="font-monospace fw-bold">${serial}</td>
                    <td>${item.property_no || '-'}</td>
                    <td class="small">${item.description || '-'}</td>
                    <td><span class="badge bg-light text-dark border">${item.asset_no || '-'}</span></td>
                    <td class="text-center">${statusBadge}</td>
                </tr>
            `;
        });
        tbody.innerHTML = htmlBuffer;

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${err.message}</td></tr>`;
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

    let htmlBuffer = "";
    data.slice(0, 10).forEach(row => {
        const serial = String(row.serial || row.Serial || row['Serial No.'] || row['Serial Number'] || '');
        const desc = String(row.description || row.Description || row.desc || '');
        const asset = String(row.asset_no || row['Asset No'] || row['Asset Tag'] || row.asset || '');
        const prop = String(row.property_no || row['Property No'] || row['Property No.'] || '');
        
        htmlBuffer += `<tr><td>${serial}</td><td>${prop}</td><td>${desc}</td><td>${asset}</td></tr>`;
    });
    if (data.length > 10) htmlBuffer += `<tr><td colspan="4" class="text-center text-muted small py-2 bg-light">...and ${data.length - 10} more items</td></tr>`;
    tbody.innerHTML = htmlBuffer;
}

export async function saveBulkImport() {
    if (!state.tempImportData || state.tempImportData.length === 0) return;
    const btn = document.getElementById('saveBulkBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Saving to DB...";
    }

    const formatted = state.tempImportData.map(row => {
        return {
            serial: String(row.serial || row.Serial || row['Serial No.'] || row['Serial Number'] || '').trim(),
            property_no: String(row.property_no || row['Property No'] || row['Property No.'] || '').trim(),
            description: String(row.description || row.Description || row.desc || '').trim(),
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