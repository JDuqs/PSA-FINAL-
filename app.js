// Main Application Entry Point - The "Conductor"
import { state } from './state.js';
import * as config from './config.js';
import * as auth from './auth.js';
import * as inventory from './inventory.js';
import * as data from './data.js';
import * as render from './render.js';
import * as workflow from './workflow.js';
import * as exports from './exports.js';
import * as utils from './utils.js';

// --- ATTACH FUNCTIONS TO WINDOW ---
window.supabase = config.supabase; 
window.handleLogin = auth.handleLogin;
window.handleSignup = auth.handleSignup;
window.approveUser = auth.approveUser;
window.cancelRequest = auth.cancelRequest;
window.removeItem = inventory.removeItem;
window.selectInventoryItem = inventory.selectInventoryItem;
window.handleBulkAdd = inventory.handleBulkAdd;
window.loadMasterInventory = inventory.loadMasterInventory;
window.loadPhilSysInventoryTable = inventory.loadPhilSysInventoryTable;

// FIX: Point these to the correct workflow functions to fix Master Inventory loading/saving
window.processImportFile = workflow.processImportFile; 
window.saveBulkImport = workflow.saveBulkImport;

window.approveBatch = workflow.approveBatch;
window.confirmReleaseBatch = workflow.confirmReleaseBatch;
window.rejectBatch = workflow.rejectBatch;
window.rejectRequest = workflow.rejectRequest;
window.triggerExportModal = exports.triggerExportModal;
window.changeLimit = render.changeLimit;
window.changePage = render.changePage;
window.updateBatchDueDate = render.updateBatchDueDate;
window.showNotificationsModal = render.showNotificationsModal; 
window.dismissNotification = render.dismissNotification; 

// NEW: Expose Historical Import
window.handleHistoricalImport = workflow.handleHistoricalImport;

// Cart Pagination & Utility Functions (FIXED: Now properly exported from inventory.js)
window.setCartLimit = inventory.setCartLimit;
window.changeCartPage = inventory.changeCartPage;
window.clearCart = inventory.clearCart;

// Export modal buttons
document.getElementById('btnExportExcel')?.addEventListener('click', exports.exportExcel);
document.getElementById('btnExportGatePass')?.addEventListener('click', exports.exportGatePass);
document.getElementById('btnExportTransmittal')?.addEventListener('click', exports.exportTransmittal);
document.getElementById('btnExportAckReceipt')?.addEventListener('click', exports.exportAckReceipt);

document.getElementById('openUnifiedExportModalBtn')?.addEventListener('click', exports.openUnifiedExportModal);
document.getElementById('btnSelectAllUnified')?.addEventListener('click', () => {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let tableId = 'activeTableBody';
    if (activeViewId === 'view-approvals') {
        tableId = 'releasingTableBody';
    } else {
        const context = document.querySelector('#recordsTabs .nav-link.active')?.getAttribute('data-context') || 'active';
        tableId = context === 'active' ? 'activeTableBody' : (context === 'history' ? 'historyTableBody' : 'archiveTableBody');
    }
    document.querySelectorAll(`#${tableId} .export-check`).forEach(box => { box.checked = true; });
    render.updateUnifiedSelectionCount();
});
document.getElementById('btnDeselectAllUnified')?.addEventListener('click', () => {
    document.querySelectorAll('.export-check:checked, .export-item-check:checked').forEach(box => { box.checked = false; });
    render.updateUnifiedSelectionCount();
});
document.addEventListener('change', (e) => {
    if (e.target?.classList?.contains('export-check') || e.target?.classList?.contains('export-item-check')) render.updateUnifiedSelectionCount();
});

// Inventory Import Listeners
const processImportBtn = document.getElementById('processImportBtn');
if (processImportBtn) { processImportBtn.addEventListener('click', workflow.processImportFile); }
document.getElementById('saveBulkBtn')?.addEventListener('click', workflow.saveBulkImport);
document.getElementById('exportInventoryBtn')?.addEventListener('click', inventory.exportMasterInventoryExcel);

// Confirm Release & Historical Submit Listeners
document.getElementById('btnConfirmRelease')?.addEventListener('click', workflow.handleReleaseSubmit);
document.getElementById('btnSubmitHistorical')?.addEventListener('click', workflow.handleHistoricalImport);

// --- INITIALIZATION ---
export async function initDashboard(user) {
    const borrowerInput = document.getElementById('borrower');
    const issueBtn = document.getElementById('issueBtn');
    const returnSection = document.getElementById('returnSection'); 
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const exportToolbar = document.getElementById('exportToolbarContainer');
    const histModalBtn = document.getElementById('btnOpenHistoricalModal'); // Now in Archive Tab
    
    if (!user || !user.email) return;

    state.currentUserName = config.ADMIN_NAMES[user.email] || user.email.split('@')[0]; 
    
    if (!config.ADMIN_NAMES[user.email]) {
        try {
            const { data: userProfile } = await config.supabase.from('users').select('name').eq('email', user.email).single();
            if (userProfile && userProfile.name) state.currentUserName = userProfile.name;
        } catch(e) {}
    }

    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) {
        userDisplay.innerHTML = `<i class="fa fa-circle-user me-2 fs-5"></i><span>${state.currentUserName}</span>`;
    }

    const userData = await config.supabase.from('users').select('*').eq('email', user.email).single().then(r => r.data);
    const currentUser = {
        ...user,
        ...(userData || {}),
        email: user.email,
        department: userData?.department || user.user_metadata?.department || '',
        role: userData?.role || user.role || ''
    };

    state.currentUser = currentUser;

    const isViewerUser = config.isViewerAdmin(currentUser);
    const isStation1 = config.isStation1Admin(currentUser);
    const isStation2 = config.isStation2Admin(currentUser);
    const isStation2PhilSys = config.isStation2PhilSysAdmin(currentUser);
    const isStation3 = config.isStation3Admin(currentUser);
    const isStation4 = config.isStation4Admin(currentUser);
    const userIsAdmin = config.isAnyAdmin(currentUser);

    if (userIsAdmin) {
        const canManageFiles = config.canManageFiles(currentUser);

    if (adminPanelBtn) adminPanelBtn.style.display = (isStation4 || isStation1) ? 'flex' : 'none';
        if (returnSection) returnSection.style.display = isStation4 ? 'block' : 'none';
        
        if (exportToolbar) exportToolbar.style.setProperty('display', canManageFiles ? 'flex' : 'none', 'important');
        if (histModalBtn) histModalBtn.style.display = canManageFiles ? 'block' : 'none';
        
        // UNHIDE BULK IMPORT TAB FOR ADMINS
        const bulkNav = document.getElementById('bulkImportNav');
        if (bulkNav) bulkNav.style.display = canManageFiles ? 'block' : 'none';
        
        ['stn1','stn2','stn3','stn4'].forEach(id => { const el = document.getElementById('nav-'+id); if(el) el.style.display = 'none'; });
        
        if (isStation1) {
            const el = document.getElementById('nav-stn1'); if(el) el.style.display = 'block';
            const stn2El = document.getElementById('nav-stn2'); if(stn2El) stn2El.style.display = 'block';
            document.querySelector('#nav-stn1 button')?.classList.add('active');
            document.getElementById('stn1Pane')?.classList.add('show', 'active');
            // Station 1 gets Master Inventory access
            const invNav = document.getElementById('navMasterInventory');
            if (invNav) invNav.style.display = 'flex';
        } 
        else if (isStation2) {
            const stn1El = document.getElementById('nav-stn1'); if(stn1El) stn1El.style.display = 'block';
            const el = document.getElementById('nav-stn2'); if(el) el.style.display = 'block';
            document.querySelector('#nav-stn2 button')?.classList.add('active');
            document.getElementById('stn2Pane')?.classList.add('show', 'active');
        }
        else if (isStation2PhilSys) {
            // PhilSys-only Station 2 — sees Station 2 tab only, data is filtered to PhilSys in data.js
            const el = document.getElementById('nav-stn2'); if(el) el.style.display = 'block';
            document.querySelector('#nav-stn2 button')?.classList.add('active');
            document.getElementById('stn2Pane')?.classList.add('show', 'active');
        }
        else if (isStation3) {
            const el = document.getElementById('nav-stn3'); if(el) el.style.display = 'block';
            document.querySelector('#nav-stn3 button')?.classList.add('active');
            document.getElementById('stn3Pane')?.classList.add('show', 'active');
        }
        else if (isStation4 || isViewerUser) {
            ['stn1','stn2','stn3','stn4'].forEach(id => { const el = document.getElementById('nav-'+id); if(el) el.style.display = 'block'; });
            
            if (isStation4) {
                document.querySelector('#nav-stn4 button')?.classList.add('active');
                document.getElementById('stn4Pane')?.classList.add('show', 'active');
            } else {
                document.querySelector('#nav-stn1 button')?.classList.add('active');
                document.getElementById('stn1Pane')?.classList.add('show', 'active');
            }
        }

        if (issueBtn) {
            if (isViewerUser) {
                issueBtn.innerText = "SUBMIT REQUEST";
                issueBtn.disabled = false;
                document.getElementById('addToCartBtn').disabled = false;
            } else {
                issueBtn.innerText = "ISSUE GATE PASS";
            }
        }
    } else {
        if (window.location.href.includes('admin')) { window.location.href = 'dashboard.html'; return; }
        if (returnSection) returnSection.style.display = 'none';
        if (exportToolbar) exportToolbar.style.setProperty('display', 'none', 'important');
        if (histModalBtn) histModalBtn.style.display = 'none';

        document.querySelector('#nav-stn1 button')?.classList.add('active');
        document.getElementById('stn1Pane')?.classList.add('show', 'active');
        if (borrowerInput) { borrowerInput.value = state.currentUserName; borrowerInput.readOnly = true; }
        if (issueBtn) { issueBtn.innerText = "SUBMIT REQUEST"; issueBtn.classList.add('btn-success'); }
    }
    
    if(document.getElementById('activeTableBody')) {
        data.loadAllRecords();
        inventory.updateBorrowedStatus();
        utils.updateClock();
        
        const activeSearch = document.getElementById('tableSearch');
        if (activeSearch) activeSearch.addEventListener('input', (e) => { state.pagination.active.filter = e.target.value.toLowerCase(); state.pagination.active.page = 1; render.renderTable('active'); });

        // Add Archive Table Search Listener
        const archiveSearch = document.getElementById('archiveSearchInput');
        if (archiveSearch) archiveSearch.addEventListener('input', (e) => { state.pagination.archive.filter = e.target.value.toLowerCase(); state.pagination.archive.page = 1; render.renderArchiveTable(); });
    }
    
    if (isStation4) {
        setTimeout(() => render.populateReturnSelector(), 3000);
    }
}

// --- EVENT LISTENERS ---
document.getElementById('loginBtn')?.addEventListener('click', auth.handleLogin);
document.getElementById('loginForm')?.addEventListener('submit', auth.handleLogin);
document.getElementById('requestBtn')?.addEventListener('click', auth.handleSignup);
document.getElementById('signupForm')?.addEventListener('submit', auth.handleSignup);
document.getElementById('logoutBtn')?.addEventListener('click', async () => { localStorage.removeItem('session_token'); await config.supabase.auth.signOut(); window.location.href = 'index.html'; });

document.getElementById('addToCartBtn')?.addEventListener('click', () => {
    const s = document.getElementById('serial').value;
    const p = document.getElementById('propertyNum').value;
    const d = document.getElementById('desc').value;
    const a = document.getElementById('asset').value;
    if (!s || !d) return alert("Fill Serial/Desc");
    if (state.cart.some(i => i.serial === s)) return alert("Already in list");
    if (state.borrowedSerials.has(s)) return alert(`Item ${s} is currently MARKED AS OUT or PENDING APPROVAL.`);
    state.cart.push({ serial: s, property_no: p, desc: d, asset: a });
    inventory.renderCart();
    document.getElementById('serial').value=""; document.getElementById('propertyNum').value=""; document.getElementById('desc').value=""; document.getElementById('asset').value="";
});

document.getElementById('issueBtn')?.addEventListener('click', workflow.handleIssue);
document.getElementById('returnBtn')?.addEventListener('click', workflow.handleReturn);
document.getElementById('serial')?.addEventListener('change', (e) => {
    if(e.target.value.length > 3) {
        config.supabase.from('inventory').select('*').eq('serial', e.target.value).single().then(({data}) => {
            if(data) { document.getElementById('desc').value = data.description; document.getElementById('asset').value = data.asset_no; if(document.getElementById('propertyNum')) document.getElementById('propertyNum').value = data.property_no; }
        });
    }
});

document.getElementById('btnOpenInventoryLookup')?.addEventListener('click', () => {
    const el = document.getElementById('inventoryLookupModal');
    if(el && window.bootstrap) {
        const modal = window.bootstrap.Modal.getOrCreateInstance(el);
        modal.show();
        inventory.loadInventoryStats();
        inventory.renderInventoryLookupTable('');
        const searchInput = document.getElementById('inventorySearchInput');
        if(searchInput) searchInput.value = "";
    }
});

document.getElementById('inventorySearchInput')?.addEventListener('input', (e) => {
    inventory.renderInventoryLookupTable(e.target.value);
});

document.getElementById('inventoryCategoryFilter')?.addEventListener('change', () => {
    const term = document.getElementById('inventorySearchInput').value;
    inventory.renderInventoryLookupTable(term);
});

document.getElementById('btnBulkAdd')?.addEventListener('click', inventory.handleBulkAdd);

const navButtons = document.querySelectorAll('.nav-item-btn[data-target]');
navButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.app-view').forEach(view => { view.classList.remove('active-view'); setTimeout(() => view.style.display = 'none', 50); });
        navButtons.forEach(b => b.classList.remove('active'));
        setTimeout(() => {
            const targetId = btn.getAttribute('data-target');
            const targetView = document.getElementById(targetId);
            if (targetView) { targetView.style.display = 'block'; targetView.classList.add('active-view'); }
            render.updateUnifiedSelectionCount();
        }, 60);
        btn.classList.add('active');
        const titleEl = document.getElementById('topbar-title');
        if (titleEl) titleEl.innerText = btn.innerText.trim();
    });
});

if (window.location.pathname.includes('admin')) {
    auth.loadRegistrationRequests();
    auth.startAdminBadgeMonitor();
}

async function checkUserSession() {
    const { data: { session } } = await config.supabase.auth.getSession();
    const path = window.location.pathname;
    if (session) {
        state.currentUser = session.user;
        if (path.includes('index.html') || path.includes('signup.html') || path === '/') { window.location.href = 'dashboard.html'; return; }
        if (path.includes('dashboard')) { initDashboard(session.user); }
    } else {
        if (path.includes('dashboard') || path.includes('admin')) { window.location.href = 'index.html'; }
    }
}

window.addEventListener('DOMContentLoaded', () => { 
    checkUserSession(); 
    const exportModal = document.getElementById('exportModal');
    if (exportModal) { exportModal.addEventListener('hidden.bs.modal', () => { state.tempExportItems = null; }); }
});
