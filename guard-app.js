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
let pendingPasses = [];
let historyPasses = [];

const PENDING_STATUS_LABELS = {
    PENDING_PROPERTY: 'Station 1 - Property',
    PENDING_INSPECTION: 'Station 2 - Inspection',
    PENDING_OIC: 'Station 3 - OIC',
    RELEASING: 'Station 4 - For Release'
};

const guardPagination = {
    out: { page: 1, pageSize: 15 },
    pending: { page: 1, pageSize: 15 },
    history: { page: 1, pageSize: 15 }
};

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
    document.getElementById('outSearchInput').addEventListener('input', debounce(() => {
        guardPagination.out.page = 1;
        renderOutTable();
    }, 300));
    document.getElementById('pendingSearchInput')?.addEventListener('input', debounce(() => {
        guardPagination.pending.page = 1;
        renderPendingTable();
    }, 300));
    document.getElementById('historySearchInput')?.addEventListener('input', debounce(() => {
        guardPagination.history.page = 1;
        renderHistoryTable();
    }, 300));
    document.getElementById('outPageSize')?.addEventListener('change', () => updateGuardPageSize('out'));
    document.getElementById('pendingPageSize')?.addEventListener('change', () => updateGuardPageSize('pending'));
    document.getElementById('historyPageSize')?.addEventListener('change', () => updateGuardPageSize('history'));
    document.getElementById('outPrevBtn')?.addEventListener('click', () => changeGuardPage('out', -1));
    document.getElementById('outNextBtn')?.addEventListener('click', () => changeGuardPage('out', 1));
    document.getElementById('pendingPrevBtn')?.addEventListener('click', () => changeGuardPage('pending', -1));
    document.getElementById('pendingNextBtn')?.addEventListener('click', () => changeGuardPage('pending', 1));
    document.getElementById('historyPrevBtn')?.addEventListener('click', () => changeGuardPage('history', -1));
    document.getElementById('historyNextBtn')?.addEventListener('click', () => changeGuardPage('history', 1));
document.getElementById('guardLogoutBtn').onclick = async (e) => {
    e.preventDefault();
    if (confirm('Logout?')) await logoutGuard();
};

    // Stock view listeners
    document.getElementById('guardStockCategory').addEventListener('change', renderGuardStock);
    document.getElementById('guardStockSearch').addEventListener('input', debounce(renderGuardStock, 300));

    // Polling
    setInterval(loadGuardData, 10000); // 10s refresh
});

async function loadGuardData() {
    try {
        // Guard OUT view should only show items that were actually released.
        const { data: activeData, error } = await supabase
            .from('gate_passes')
            .select(`
                id, unique_id, borrower, project, guard_out, time_out, due_date, status, release_pdf_url
            `)
            .eq('status', 'OUT')
            .order('time_out', { ascending: false })
            .limit(200);
            
        if (error) {
            console.error('OUT passes load error:', error);
            outPasses = [];
        } else {
            outPasses = activeData || [];
        }
        renderOutTable();
        const outBatchCount = new Set(outPasses.map(item => item.unique_id)).size || 0;
        document.getElementById('outCountBadge').textContent = outBatchCount;
        updateGuardSidebarBadge('sidebarOutCountBadge', outBatchCount);

        const { data: pendingData, error: pendingError } = await supabase
            .from('gate_passes')
            .select(`
                id, unique_id, borrower, project, due_date, status
            `)
            .in('status', Object.keys(PENDING_STATUS_LABELS))
            .order('id', { ascending: false })
            .limit(200);

        if (pendingError) {
            console.error('Pending passes load error:', pendingError);
            pendingPasses = [];
        } else {
            pendingPasses = pendingData || [];
        }
        renderPendingTable();
        const pendingBatchCount = new Set(pendingPasses.map(item => item.unique_id)).size || 0;
        document.getElementById('pendingCountBadge').textContent = pendingBatchCount;
        updateGuardSidebarBadge('sidebarPendingCountBadge', pendingBatchCount);

        // Load history (RETURNED/ARCHIVED)
        const { data: historyData, histError } = await supabase
            .from('gate_passes')
            .select(`
                id, unique_id, borrower, project, guard_in, time_out, time_return, due_date, status, return_receipt_url, release_pdf_url
            `)
            .or('status.eq.RETURNED,status.eq.ARCHIVED')
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

function renderPendingTable(filter = '') {
    const tbody = document.getElementById('pendingItemsTableBody');
    if (!tbody) return;

    const normalizedFilter = typeof filter === 'string'
        ? filter.toLowerCase()
        : String(document.getElementById('pendingSearchInput')?.value || '').toLowerCase();

    const filtered = pendingPasses.filter(p =>
        String(p.unique_id || '').toLowerCase().includes(normalizedFilter) ||
        String(p.borrower || '').toLowerCase().includes(normalizedFilter) ||
        String(p.project || '').toLowerCase().includes(normalizedFilter)
    );

    const groups = {};
    filtered.forEach(pass => {
        if (!groups[pass.unique_id]) {
            groups[pass.unique_id] = [];
        }
        groups[pass.unique_id].push(pass);
    });

    tbody.innerHTML = '';

    const uniqueIds = Object.keys(groups);
    if (!uniqueIds.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No pending approvals found.</td></tr>';
        updateGuardPaginationControls('pending', 0, 0, 0);
        return;
    }

    const paginatedIds = getPaginatedIds(uniqueIds, 'pending');

    paginatedIds.forEach(uniqueId => {
        const passGroup = groups[uniqueId][0];
        const itemCount = groups[uniqueId].length;
        const stageLabel = PENDING_STATUS_LABELS[passGroup.status] || passGroup.status || 'Pending';
        const stageBadgeClass = passGroup.status === 'RELEASING' ? 'bg-primary' : 'bg-warning text-dark';

        tbody.innerHTML += `
            <tr class="table-light border-bottom border-2 align-middle">
                <td class="fw-bold text-primary p-2">${uniqueId}</td>
                <td class="fw-bold">${passGroup.borrower || '-'}</td>
                <td>${passGroup.project || '-'}</td>
                <td><span class="badge bg-secondary">${itemCount} items</span></td>
                <td><span class="badge ${stageBadgeClass}">${stageLabel}</span></td>
                <td>${formatDateCell(passGroup.due_date)}</td>
                <td><span class="badge bg-light text-dark border">${passGroup.status || 'Pending'}</span></td>
            </tr>`;
    });

    updateGuardPaginationControls('pending', uniqueIds.length, paginatedIds.length, guardPagination.pending.page);
}

function renderOutTable(filter = '') {
    const tbody = document.getElementById('outItemsTableBody');
    if (!tbody) return;

    const normalizedFilter = typeof filter === 'string'
        ? filter.toLowerCase()
        : String(document.getElementById('outSearchInput')?.value || '').toLowerCase();

    let filtered = outPasses.filter(p => 
        String(p.unique_id || '').toLowerCase().includes(normalizedFilter) ||
        String(p.borrower || '').toLowerCase().includes(normalizedFilter) ||
        String(p.project || '').toLowerCase().includes(normalizedFilter)
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

    const uniqueIds = Object.keys(groups);
    if (!uniqueIds.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No OUT items found.</td></tr>';
        updateGuardPaginationControls('out', 0, 0, 0);
        return;
    }

    const paginatedIds = getPaginatedIds(uniqueIds, 'out');

    paginatedIds.forEach(uniqueId => {
        const passGroup = groups[uniqueId][0]; // First pass for common info
        const itemCount = groups[uniqueId].length;
        const safeId = uniqueId.replace(/[^a-zA-Z0-9]/g, '_');
        const documentCell = passGroup.release_pdf_url
            ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="window.openGuardDocument('${passGroup.release_pdf_url}', event)"><i class="fa fa-file-pdf me-1"></i>View Document</button>`
            : `<span class="text-muted small">-</span>`;

        tbody.innerHTML += `
            <tr class="table-light border-bottom border-2 align-middle" style="cursor: pointer;" onclick="loadPassItems('${uniqueId}')" data-bs-toggle="collapse" data-bs-target="#collapse-out-${safeId}">
                <td class="fw-bold text-primary p-2">
                    <i class="fa fa-chevron-right me-2" id="icon-out-${safeId}"></i>
                    ${uniqueId}
                </td>
                <td class="fw-bold">${passGroup.borrower || '-'}</td>
                <td>${passGroup.project || '-'}</td>
                <td><span class="badge bg-secondary">${itemCount} items</span></td>
                <td>${formatDateCell(passGroup.time_out)}</td>
                <td>
                    ${formatDateCell(passGroup.due_date)}
                    <span class="badge ms-2 ${isOverdue(passGroup.due_date) ? 'bg-danger' : 'bg-warning text-dark'}">${formatDueDate(passGroup.due_date)}</span>
                </td>
                <td onclick="event.stopPropagation()">${documentCell}</td>
                <td>
                    <span class="badge status-out">OUT</span>
                    <div class="small text-muted mt-1">Guard OUT: ${passGroup.guard_out || 'Unassigned'}</div>
                </td>
            </tr>

            <tr class="p-0">
                <td colspan="8">
                    <div id="collapse-out-${safeId}" class="collapse">
                        <div id="items-out-${safeId}" class="p-3">
                            <div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading items...
                        </div>
                    </div>
                </td>
            </tr>`;
    });

    updateGuardPaginationControls('out', uniqueIds.length, paginatedIds.length, guardPagination.out.page);
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

    const normalizedFilter = typeof filter === 'string'
        ? filter.toLowerCase()
        : String(document.getElementById('historySearchInput')?.value || '').toLowerCase();

    let filtered = historyPasses.filter(p => 
        String(p.unique_id || '').toLowerCase().includes(normalizedFilter) ||
        String(p.borrower || '').toLowerCase().includes(normalizedFilter) ||
        String(p.project || '').toLowerCase().includes(normalizedFilter)
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
    const uniqueIds = Object.keys(groups);
    if (!uniqueIds.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No history found.</td></tr>';
        updateGuardPaginationControls('history', 0, 0, 0);
        return;
    }

    const paginatedIds = getPaginatedIds(uniqueIds, 'history');

    paginatedIds.forEach(uniqueId => {
        const passGroup = groups[uniqueId][0]; // First pass for common info
        const itemCount = groups[uniqueId].length;
        const safeId = uniqueId.replace(/[^a-zA-Z0-9]/g, '_');

        const historyStatusClass = passGroup.status === 'RETURNED' ? 'status-returned' : 'bg-secondary';
        const historyDocumentUrl = passGroup.return_receipt_url || passGroup.release_pdf_url;
        const documentCell = historyDocumentUrl
            ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="window.openGuardDocument('${historyDocumentUrl}', event)"><i class="fa fa-file-pdf me-1"></i>View Document</button>`
            : `<span class="text-muted small">-</span>`;
        tbody.innerHTML += `
            <tr class="table-light border-bottom border-2 align-middle" style="cursor: pointer;" onclick="loadPassItems('${uniqueId}', 'hist')" data-bs-toggle="collapse" data-bs-target="#collapse-hist-${safeId}">
                <td class="fw-bold text-secondary p-2">
                    <i class="fa fa-chevron-right me-2" id="icon-hist-${safeId}"></i>
                    ${uniqueId}
                </td>
                <td class="fw-bold">${passGroup.borrower || '-'}</td>
                <td>${passGroup.project || '-'}</td>
                <td><span class="badge bg-secondary">${itemCount} items</span></td>
                <td>${formatDateCell(passGroup.time_out)}</td>
                <td>${formatDateCell(passGroup.time_return || passGroup.time_out)}</td>
                <td onclick="event.stopPropagation()">${documentCell}</td>
                <td>
                    <span class="badge ${historyStatusClass}">${passGroup.status || 'History'}</span>
                    <div class="small text-muted mt-1">Guard IN: ${passGroup.guard_in || 'Unassigned'}</div>
                </td>
            </tr>
            <tr class="p-0">
                <td colspan="8">
                    <div id="collapse-hist-${safeId}" class="collapse">
                        <div id="items-hist-${safeId}" class="p-3">
                            <div class="spinner-border spinner-border-sm text-secondary me-2"></div>Loading items...
                        </div>
                    </div>
                </td>
            </tr>`;
    });

    updateGuardPaginationControls('history', uniqueIds.length, paginatedIds.length, guardPagination.history.page);
}

function getPaginatedIds(ids, key) {
    const pagination = guardPagination[key];
    const totalPages = Math.max(1, Math.ceil(ids.length / pagination.pageSize));
    if (pagination.page > totalPages) {
        pagination.page = totalPages;
    }
    if (pagination.page < 1) {
        pagination.page = 1;
    }
    const start = (pagination.page - 1) * pagination.pageSize;
    return ids.slice(start, start + pagination.pageSize);
}

function updateGuardPageSize(key) {
    const select = document.getElementById(`${key}PageSize`);
    if (!select) return;
    guardPagination[key].pageSize = parseInt(select.value, 10) || 15;
    guardPagination[key].page = 1;
    rerenderGuardSection(key);
}

function changeGuardPage(key, delta) {
    guardPagination[key].page += delta;
    rerenderGuardSection(key);
}

function rerenderGuardSection(key) {
    if (key === 'out') renderOutTable();
    if (key === 'pending') renderPendingTable();
    if (key === 'history') renderHistoryTable();
}

function updateGuardPaginationControls(key, totalItems, shownItems, currentPage) {
    const infoEl = document.getElementById(`${key}PaginationInfo`);
    const prevBtn = document.getElementById(`${key}PrevBtn`);
    const nextBtn = document.getElementById(`${key}NextBtn`);
    const pagination = guardPagination[key];
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / pagination.pageSize) : 1;

    if (pagination.page > totalPages) {
        pagination.page = totalPages;
    }

    const start = totalItems === 0 ? 0 : ((pagination.page - 1) * pagination.pageSize) + 1;
    const end = totalItems === 0 ? 0 : Math.min(start + shownItems - 1, totalItems);

    if (infoEl) {
        infoEl.textContent = totalItems === 0
            ? 'Showing 0 of 0'
            : `Showing ${start}-${end} of ${totalItems}`;
    }

    if (prevBtn) prevBtn.disabled = pagination.page <= 1 || totalItems === 0;
    if (nextBtn) nextBtn.disabled = pagination.page >= totalPages || totalItems === 0;
}

function updateGuardSidebarBadge(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('d-none', count === 0);
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
    if (Number.isNaN(due.getTime())) return false;
    due.setHours(23, 59, 59);
    return new Date() > due;
}

function formatDueDate(dueDate) {
    if (!dueDate) return 'No due date';
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return 'Invalid date';
    const today = new Date();
    today.setHours(0,0,0,0);
    if (due < today) return 'OVERDUE';
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    return diffDays === 1 ? 'Tomorrow' : `${diffDays} days`;
}

function formatDateCell(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-PH');
}

window.openGuardDocument = function(url, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
};

// Export for window usage
window.loadGuardData = loadGuardData;
window.renderOutTable = renderOutTable;

