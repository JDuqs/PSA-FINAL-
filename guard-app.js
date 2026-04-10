// Guard Dashboard App Logic (w/ Available Stock)
import { supabase } from './config.js';
import { state } from './state.js';
// No data.js dependency for guard view-only
import * as inventory from './inventory.js';
import { fetchAllRecords } from './inventory.js';
import { showConfirm } from './utils.js';
import { detectItemCategory } from './inventory.js';

console.log('🛡️ Guard Dashboard Active w/ Stock View');

let outPasses = [];
let historyPasses = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Verify Supabase session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
        localStorage.removeItem('session_token');
        localStorage.removeItem('guard_name');
        window.location.href = 'guardsupplies.html';
        return;
    }

    // Validate guard role from DB
    const { data: userData } = await supabase
        .from('users')
        .select('role, department')
        .eq('email', session.user.email)
        .single();
    
    const isGuard = userData?.role === 'guard' || userData?.department?.toLowerCase() === 'guard';
    if (!isGuard) {
        alert('Access denied. Contact Admin.');
        supabase.auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    state.currentUser = session.user;
    localStorage.setItem('guard_name', userData.name || session.user.user_metadata?.full_name || session.user.email.split('@')[0]);

    console.log('🛡️ Guard session validated:', session.user.email);
    await loadGuardData();

    // Event listeners
    // Search OUT
    document.getElementById('outSearchInput').addEventListener('input', debounce(renderOutTable, 300));

    // History search
    document.getElementById('historySearchInput')?.addEventListener('input', debounce(renderHistoryTable, 300));
document.getElementById('guardLogoutBtn').onclick = async (e) => {
    e.preventDefault();
    if (confirm('Logout?')) await logoutGuard();
};

    // Search OUT
    document.getElementById('outSearchInput').addEventListener('input', debounce(renderOutTable, 300));

    // Stock view listeners
    document.getElementById('guardStockCategory').addEventListener('change', renderGuardStock);
    document.getElementById('guardStockSearch').addEventListener('input', debounce(renderGuardStock, 300));

    // Polling
    setInterval(loadGuardData, 10000); // 10s refresh
});

async function loadGuardData() {
    try {
        // Load active OUT passes (direct query since view-only)
    const { data: activeData, error } = await supabase
        .from('gate_passes')
        .select(`
            id, unique_id, borrower, project, guard_out, time_out, due_date, status
        `)



            .not('status', 'eq', 'RETURNED')
            .not('status', 'eq', 'ARCHIVED')
            .order('time_out', { ascending: false })
            .limit(200);
            
        if (error) {
            console.error('OUT passes load error:', error);
            outPasses = [];
        } else {
            outPasses = activeData || [];
        }
        renderOutTable();
        document.getElementById('outCountBadge').textContent = outPasses.length || 0;

        // Load history (RETURNED/ARCHIVED)
    const { data: historyData, histError } = await supabase
        .from('gate_passes')
        .select(`
            id, unique_id, borrower, project, guard_in, time_out, time_return, due_date, status
        `)



            .or('status.eq.RETURNED, status.eq.ARCHIVED')

            .order('time_return', { ascending: false, nullsFirst: false })
            .limit(200);
            
        if (histError) {
            console.error('History passes load error:', histError);
            historyPasses = [];
        } else {
            historyPasses = historyData || [];
        }
        renderHistoryTable();
        document.getElementById('historyCountBadge').textContent = historyPasses.length || 0;

        await loadGuardStock();

    } catch (e) {
        console.error('Guard data load error:', e);
    }
}

async function loadGuardStock() {
    try {
        console.log('🔄 Loading ALL inventory for guard stock...');
        state.borrowedSerials = new Set(); // Guard read-only - no borrowed tracking
        state.guardStock = await fetchAllRecords('inventory');
        console.log(`✅ Loaded ${state.guardStock.length} total inventory items`);
        document.getElementById('availableCountBadge').textContent = state.guardStock.length;
        renderGuardStock();
    } catch (e) {
        console.error('Stock load error:', e);
        document.getElementById('guardStockTableBody').innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4">Stock load failed: ${e.message}</td></tr>`;
    }
}

function renderGuardStock() {
    const tbody = document.getElementById('guardStockTableBody');
    const category = document.getElementById('guardStockCategory')?.value || 'All';
    const search = document.getElementById('guardStockSearch')?.value.toLowerCase() || '';

    if (!tbody || !state.guardStock) return;

    let filtered = state.guardStock.filter(item => {
        const serial = String(item.serial || '').toLowerCase();
        const desc = String(item.description || '').toLowerCase();
        const asset = String(item.asset_no || '').toLowerCase();
        const cat = detectItemCategory(item.description || '');

        return (!search || serial.includes(search) || desc.includes(search) || asset.includes(search)) &&
               (category === 'All' || cat === category);
    });

    filtered.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

    tbody.innerHTML = filtered.length ? '' : '<tr><td colspan="4" class="text-center text-muted py-4">No available items found.</td></tr>';

    filtered.forEach(item => { // Unlimited display, future-proof
        const cat = detectItemCategory(item.description || '');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="fw-bold font-monospace">${item.serial}</td>
            <td class="small">${item.description}</td>
            <td><span class="badge bg-light text-dark">${item.asset_no || 'N/A'}</span></td>
            <td><span class="badge bg-success">${cat}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function renderOutTable(filter = '') {
    const tbody = document.getElementById('outItemsTableBody');
    if (!tbody) return;

    let filtered = outPasses.filter(p => 
        p.unique_id.toLowerCase().includes(filter.toLowerCase()) ||
        p.borrower.toLowerCase().includes(filter.toLowerCase()) ||
        p.project.toLowerCase().includes(filter.toLowerCase())
    );

    // Group by unique_id
    const groups = {};
    filtered.forEach(pass => {
        if (!groups[pass.unique_id]) {
            groups[pass.unique_id] = [];
        }
        groups[pass.unique_id].push(pass);
    });

    tbody.innerHTML = '';

    Object.keys(groups).forEach(uniqueId => {
        const passGroup = groups[uniqueId][0]; // First pass for common info
        const itemCount = groups[uniqueId].length;
        const safeId = uniqueId.replace(/[^a-zA-Z0-9]/g, '_');



        tbody.innerHTML += `
            <tr class="table-light border-bottom border-2">
                <td class="fw-bold text-primary p-2" colspan="7" style="cursor: pointer;" onclick="loadPassItems('${uniqueId}')" data-bs-toggle="collapse" data-bs-target="#collapse-out-${safeId}">
                    <i class="fa fa-chevron-right me-2" id="icon-out-${safeId}"></i>

                    ${uniqueId} - ${passGroup.borrower} (${itemCount} items) - Guard OUT: ${passGroup.guard_out || 'Unassigned'} - ${new Date(passGroup.time_out).toLocaleDateString('ph-PH')}

                    <span class="badge ms-2 ${isOverdue(passGroup.due_date) ? 'bg-danger' : 'bg-warning'}">${formatDueDate(passGroup.due_date)}</span>
                </td>
            </tr>

            <tr class="p-0">
                <td colspan="7">
                    <div id="collapse-out-${safeId}" class="collapse">
                        <div id="items-out-${safeId}" class="p-3">
                            <div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading items...
                        </div>
                    </div>
                </td>
            </tr>`;
    });
}
window.loadPassItems = async function(uniqueId, type = 'out') {
    const prefix = type === 'hist' ? 'hist' : 'out';
    const tbodyId = `items-${prefix}-${uniqueId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) {
        console.error('Item container not found:', tbodyId);
        return;
    }
    if (tbody.classList.contains('loading')) return;
    tbody.classList.add('loading');
    tbody.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading items...';
    try {
        const { data, error } = await supabase.from('gate_passes').select('serial, description, asset_no, property_no, guard_in, guard_out').eq('unique_id', uniqueId).limit(50);

        if (error) throw error;
        tbody.innerHTML = '';
        if (!data || data.length === 0) {
            tbody.innerHTML = '<div class="text-muted text-center py-3 small">No items found</div>';
        } else {
            const table = document.createElement('table');
            table.className = 'table table-sm mb-0';
            table.innerHTML = `
                <thead class="table-light">
                    <tr><th>Serial</th><th>Description</th><th>Asset No</th><th>Property No</th></tr>
                </thead>
                <tbody>`;
            data.forEach(item => {
                table.innerHTML += `
                    <tr>
                        <td class="fw-bold font-monospace">${item.serial || '-'}</td>
                        <td>${item.description || '-'}</td>
                        <td>${item.asset_no || '-'}</td>
                        <td>${item.property_no || '-'}</td>
                    </tr>`;
            });
            table.innerHTML += '</tbody>';
            tbody.appendChild(table);
        }
    } catch (e) {
        tbody.innerHTML = `<div class="alert alert-danger small mb-0">Error: ${e.message}</div>`;
    } finally {
        tbody.classList.remove('loading');
    }
};



// Toggle function
window.toggleCollapse = function(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon-out-' + id.split('-').pop());
    if (el.classList.contains('show')) {
        icon.className = 'fa fa-chevron-right me-2';
    } else {
        icon.className = 'fa fa-chevron-down me-2';
    }
};



function renderHistoryTable(filter = '') {
    const tbody = document.getElementById('historyItemsTableBody');
    if (!tbody) return;

    let filtered = historyPasses.filter(p => 
        p.unique_id.toLowerCase().includes(filter.toLowerCase()) ||
        p.borrower.toLowerCase().includes(filter.toLowerCase()) ||
        p.project.toLowerCase().includes(filter.toLowerCase())
    );

    // Group by unique_id (matching OUT table)
    const groups = {};
    filtered.forEach(pass => {
        if (!groups[pass.unique_id]) {
            groups[pass.unique_id] = [];
        }
        groups[pass.unique_id].push(pass);
    });

    tbody.innerHTML = '';
    Object.keys(groups).forEach(uniqueId => {
        const passGroup = groups[uniqueId][0]; // First pass for common info
        const itemCount = groups[uniqueId].length;
        const safeId = uniqueId.replace(/[^a-zA-Z0-9]/g, '_');

        tbody.innerHTML += `
            <tr class="table-light border-bottom border-2">
                    <td class="fw-bold text-secondary p-2" colspan="7" style="cursor: pointer;" onclick="loadPassItems('${uniqueId}', 'hist')" data-bs-toggle="collapse" data-bs-target="#collapse-hist-${safeId}">

                    <i class="fa fa-chevron-right me-2" id="icon-hist-${safeId}"></i>
                    ${uniqueId} - ${passGroup.borrower} (${itemCount} items) - Guard IN: ${passGroup.guard_in || 'Unassigned'} - Returned ${new Date(passGroup.time_return || passGroup.time_out).toLocaleDateString('ph-PH')}

                </td>
            </tr>
            <tr class="p-0">
                <td colspan="7">
                    <div id="collapse-hist-${safeId}" class="collapse">
                        <div id="items-hist-${safeId}" class="p-3">
                            <div class="spinner-border spinner-border-sm text-secondary me-2"></div>Loading items...
                        </div>
                    </div>
                </td>
            </tr>`;
    });
}








async function logoutGuard() {
    localStorage.removeItem('session_token');
    localStorage.removeItem('guard_name');
    await supabase.auth.signOut();
    window.location.href = 'guardsupplies.html';
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function isOverdue(dueDate) {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    due.setHours(23, 59, 59);
    return new Date() > due;
}

function formatDueDate(dueDate) {
    if (!dueDate) return 'No due date';
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0,0,0,0);
    if (due < today) return 'OVERDUE';
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    return diffDays === 1 ? 'Tomorrow' : `${diffDays} days`;
}

// Export for window usage
window.loadGuardData = loadGuardData;
window.renderOutTable = renderOutTable;

