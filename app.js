// 1. SUPABASE CONFIGURATION
const SUPABASE_URL = 'https://hkgjyrtjemdditazycim.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MmYypzfD2NV8vUi8GEmbRQ_OpZJcHYN';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// GLOBAL VARIABLES & ROLES
const ADMIN_ROLES = {
    STATION_1: "admin1@psa.gov.ph", // Property - Can Export, Approve Stn 1
    STATION_2: "admin2@psa.gov.ph", // Inspection - Approve Stn 2 only
    STATION_3: "admin3@psa.gov.ph", // OIC - Approve Stn 3 only
    STATION_4: "admin@psa.gov.ph"   // Release/Main - Can Export, Approve Stn 4, Return, Manage Users
};

// Helper: Check if email belongs to ANY admin
const isAnyAdmin = (email) => Object.values(ADMIN_ROLES).includes(email);

let cart = [];
let currentUserName = "";
let bulkImportData = [];
let currentSearchResults = []; 
let searchDebounceTimer; 
let borrowedSerials = new Set(); 
let currentUser = null; 
let currentExportContext = 'active'; 

// --- PAGINATION & STATE ---
let activeData = [];
let historyData = [];
let station1Data = []; 
let station2Data = []; 
let station3Data = []; 
let releasingData = []; 

// Anti-Flicker Signatures
let lastStation1Signature = ""; 
let lastStation2Signature = ""; 
let lastStation3Signature = "";
let lastReleasingSignature = ""; 
let lastActiveSignature = "";
let lastHistorySignature = "";
let lastRejectedSignature = ""; // Prevent unnecessary UI renders for notifications
let lastSelectorSignature = "";
window.tempExportItems = null; // Store temp single batch for immediate exports

let paginationState = {
    active: { page: 1, limit: 10, filter: '' },
    history: { page: 1, limit: 10, filter: '' }
};

console.log("App.js loaded. Single-Session Enforcement & Inventory Stats Active.");

// ==========================================
// SPA VIEW NAVIGATION LOGIC
// ==========================================
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-item-btn[data-target]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Hide all views
            document.querySelectorAll('.app-view').forEach(view => {
                view.classList.remove('active-view');
                setTimeout(() => view.style.display = 'none', 50);
            });
            // Remove active state from nav
            navButtons.forEach(b => b.classList.remove('active'));
            
            // Show target view
            setTimeout(() => {
                const targetId = btn.getAttribute('data-target');
                const targetView = document.getElementById(targetId);
                if (targetView) {
                    targetView.style.display = 'block';
                    targetView.classList.add('active-view');
                }
                // Update selection counts across views
                if (typeof updateUnifiedSelectionCount === 'function') updateUnifiedSelectionCount();
            }, 60);
            
            // Set active state
            btn.classList.add('active');
            
            // Update Topbar Title
            const titleEl = document.getElementById('topbar-title');
            if (titleEl) titleEl.innerText = btn.innerText.trim();
        });
    });
}

// ==========================================
// UTILS
// ==========================================
function showConfirm(title, message) {
    return new Promise((resolve) => {
        const modalEl = document.getElementById('confirmModal');
        if (!modalEl) return resolve(confirm(message));

        const titleEl = document.getElementById('confirmTitle');
        const textEl = document.getElementById('confirmText');
        const yesBtn = document.getElementById('confirmBtnYes');
        const cancelBtn = modalEl.querySelector('.btn-light, .btn-secondary'); 
        
        titleEl.innerText = title;
        textEl.innerText = message;
        
        // SAFE BOOTSTRAP MODAL CREATION
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: 'static', keyboard: false });
        modal.show();

        const handleConfirm = () => {
            modal.hide();
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            modal.hide();
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            yesBtn.onclick = null;
            if(cancelBtn) cancelBtn.onclick = null;
            modalEl.removeEventListener('hidden.bs.modal', handleCancelModalEvent);
        };

        const handleCancelModalEvent = () => {
            resolve(false);
        };

        yesBtn.onclick = handleConfirm;
        if(cancelBtn) cancelBtn.onclick = handleCancel;
        modalEl.addEventListener('hidden.bs.modal', handleCancelModalEvent, { once: true });
    });
}

async function getNextGatePassID() {
    try {
        const { data, error } = await supabase
            .from('gate_passes')
            .select('unique_id')
            .ilike('unique_id', 'PSA-%');

        if (error) throw error;

        let maxNum = 0;
        if (data && data.length > 0) {
            data.forEach(row => {
                const parts = row.unique_id.split('-');
                if (parts.length === 2) {
                    const num = parseInt(parts[1], 10);
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num;
                    }
                }
            });
        }
        
        const nextNum = maxNum + 1;
        return `PSA-${String(nextNum).padStart(3, '0')}`;
    } catch (e) {
        console.error("Error generating Gate Pass ID:", e);
        return `PSA-${Math.floor(1000 + Math.random() * 9000)}`;
    }
}

// ==========================================
// A. AUTHENTICATION & SINGLE-SESSION LOGIC
// ==========================================
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

async function checkUserSession() {
    const { data: { session } } = await supabase.auth.getSession();
    const path = window.location.pathname;

    if (session) {
        currentUser = session.user; 
        
        if (path.includes('index.html') || path.includes('signup.html') || path === '/' || path.endsWith('/')) {
            window.location.href = 'dashboard.html';
            return;
        }
        
        if (path.includes('dashboard')) {
            setupNavigation();
            initDashboard(currentUser);
        }

        if (path.includes('admin')) {
            if (currentUser.email !== ADMIN_ROLES.STATION_4) {
                window.location.href = 'dashboard.html';
            } else {
                loadRegistrationRequests();
            }
        }

    } else {
        if (path.includes('dashboard') || path.includes('admin')) {
            window.location.href = 'index.html';
        }
    }
}

async function handleLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('email').value.toLowerCase().trim();
    const password = document.getElementById('password').value;

    if (!email || !password) return alert("Please enter email and password");

    const btn = document.getElementById('loginBtn');
    if(btn) { btn.disabled = true; btn.innerText = "Verifying..."; }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) throw error;

        // --- SINGLE DEVICE ENFORCEMENT START ---
        const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        
        const { error: updateError, count } = await supabase
            .from('users')
            .update({ session_token: sessionToken })
            .eq('uid', data.user.id)
            .select('uid', { count: 'exact' });

        if (updateError || count === 0) {
            await supabase.from('users').upsert({
                uid: data.user.id,
                email: email,
                session_token: sessionToken,
                name: email.split('@')[0].toUpperCase(),
                role: isAnyAdmin(email) ? 'admin' : 'user',
                approved: true
            }, { onConflict: 'email' });
        }

        localStorage.setItem('session_token', sessionToken);
        // --- SINGLE DEVICE ENFORCEMENT END ---

        if (!isAnyAdmin(email)) {
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('*') 
                .eq('email', email)
                .single();
            
            if (userError || !userData || userData.approved !== true) {
                await supabase.auth.signOut();
                if (userError || !userData) throw new Error("Account setup incomplete. Please contact Admin.");
                if (userData.approved !== true) throw new Error("Access Denied: Pending Admin approval.");
            }
        }

        window.location.href = 'dashboard.html';

    } catch (error) {
        const msgEl = document.getElementById('errorMsg');
        let displayMsg = "Login Failed: " + error.message;
        if (error.message.includes("Invalid login credentials")) displayMsg = "Incorrect email or password.";
        
        if (msgEl) msgEl.innerText = displayMsg;
        else alert(displayMsg);
        
        await supabase.auth.signOut();
        if(btn) { btn.disabled = false; btn.innerText = "LOGIN TO SYSTEM"; }
    }
}

if (loginBtn) loginBtn.addEventListener('click', handleLogin);
if (loginForm) loginForm.addEventListener('submit', handleLogin);

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        localStorage.removeItem('session_token'); 
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });
}

// ==========================================
// B. REGISTRATION & APPROVAL
// ==========================================
const requestBtn = document.getElementById('requestBtn');
const signupForm = document.getElementById('signupForm');

async function handleSignup(e) {
    if (e) e.preventDefault();
    
    const firstName = document.getElementById('regFirstName').value.trim();
    const lastName = document.getElementById('regLastName').value.trim();
    const email = document.getElementById('regEmail').value.toLowerCase().trim();
    const pass = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;

    if (!firstName || !lastName || !email) return alert("Please fill all details.");
    if (pass.length < 6) return alert("Password must be at least 6 characters.");
    if (pass !== passConfirm) return alert("Passwords do not match!");
    
    const name = `${firstName} ${lastName}`;
    const btn = document.getElementById('requestBtn');
    if(btn) { btn.disabled = true; btn.innerText = "Processing..."; }

    try {
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email, password: pass, options: { data: { full_name: name } }
        });
        if (authError) throw authError;

        await supabase.from('registration_requests').insert([{ name, email, pass, status: 'PENDING' }]);
        
        const uid = authData.user ? authData.user.uid : null;
        await supabase.from('users').insert([{ email, name, password: pass, approved: false, role: 'user', uid: uid }]);

        alert("Request submitted! Wait for Admin approval.");
        await supabase.auth.signOut(); 
        window.location.href = 'index.html';

    } catch (error) {
        alert("Error: " + error.message);
        if(btn) { btn.disabled = false; btn.innerText = "SUBMIT ACCESS REQUEST"; }
    }
}

if (requestBtn) requestBtn.addEventListener('click', handleSignup);
if (signupForm) signupForm.addEventListener('submit', handleSignup);

async function loadRegistrationRequests() {
    const tbody = document.getElementById('requestTableBody');
    const section = document.getElementById('adminRequestSection');
    
    if (!tbody) return;
    if(section) section.style.display = 'block';

    const fetchRequests = async () => {
        try {
            const { data, error } = await supabase.from('registration_requests').select('*');
            if (error) throw error;
            
            tbody.innerHTML = "";
            if (!data || data.length === 0) {
                tbody.innerHTML = "<tr><td colspan='4' class='text-center text-muted py-3'>No pending requests.</td></tr>";
                return;
            }
            data.forEach(d => {
                tbody.innerHTML += `
                    <tr>
                        <td class="fw-bold">${d.name}</td>
                        <td>${d.email}</td>
                        <td class="text-muted"><i>Hidden for security</i></td>
                        <td class="text-center">
                            <button class="btn btn-success btn-sm me-1 fw-bold" onclick="window.approveUser('${d.id}', '${d.email}', '${d.name}', '${d.pass}')">Confirm</button>
                            <button class="btn btn-outline-danger btn-sm" onclick="window.cancelRequest('${d.id}')">Deny</button>
                        </td>
                    </tr>`;
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan='4' class='text-center text-danger'>Error loading data.</td></tr>`;
        }
    };

    fetchRequests();
}

window.approveUser = async (reqId, email, name, password) => {
    if (!await showConfirm("Approve", `Approve access for ${email}?`)) return;
    try {
        await supabase.from('users').upsert({ email: email, name: name, password: password, approved: true, role: 'user' }, { onConflict: 'email' });
        await supabase.from('registration_requests').delete().eq('id', reqId);
        alert("User Approved!");
        window.location.reload(); 
    } catch (e) { alert(e.message); }
};

window.cancelRequest = async (id) => {
    if (await showConfirm("Reject", "Delete this request completely?")) {
        try {
            await supabase.from('registration_requests').delete().eq('id', id);
            alert("Request rejected.");
            window.location.reload();
        } catch (e) { alert(e.message); }
    }
};

// ==========================================
// C. DASHBOARD INITIALIZATION
// ==========================================
async function initDashboard(user) {
    const borrowerInput = document.getElementById('borrower');
    const issueBtn = document.getElementById('issueBtn');
    const guardInput = document.getElementById('guardOut');
    
    const returnSection = document.getElementById('returnSection'); 
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const exportToolbar = document.getElementById('exportToolbarContainer');
    
    const t1 = document.getElementById('nav-stn1');
    const t2 = document.getElementById('nav-stn2');
    const t3 = document.getElementById('nav-stn3');
    const t4 = document.getElementById('nav-stn4');
    
    if (!user || !user.email) return;

    // --- INSTANT SESSION CHECKER (REALTIME) ---
    try {
        const channel = supabase.channel('session_monitor_' + user.id)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'users', filter: `uid=eq.${user.id}` },
                (payload) => {
                    const localToken = localStorage.getItem('session_token');
                    if (payload.new.session_token && payload.new.session_token !== localToken) {
                        alert("Security Alert: This account was just logged in on another device. You are being logged out.");
                        localStorage.removeItem('session_token');
                        window.location.href = 'index.html';
                    }
                }
            )
            .subscribe();
    } catch (err) { console.warn("Realtime session monitoring failed."); }

    const checkSession = async () => {
        const localToken = localStorage.getItem('session_token');
        if (!localToken) return; 

        let query = supabase.from('users').select('session_token');
        if (user.id) query = query.eq('uid', user.id);
        else query = query.eq('email', user.email);
        
        const { data: userSession, error } = await query.single();
        if (error || !userSession) return;

        if (userSession.session_token && userSession.session_token !== localToken) {
            alert("Session Expired: You have been logged in on another device.");
            await supabase.auth.signOut();
            localStorage.removeItem('session_token');
            window.location.href = 'index.html';
        }
    };

    setInterval(async () => {
        if (!document.hidden) await checkSession();
    }, 3000);
    window.addEventListener('focus', checkSession);

    try {
        const { data: userProfile } = await supabase.from('users').select('name').eq('email', user.email).single();
        if (userProfile) currentUserName = userProfile.name;
        else currentUserName = user.email.split('@')[0];
    } catch (e) {
        currentUserName = user.email.split('@')[0];
    }

    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) {
        userDisplay.innerHTML = `<i class="fa fa-circle-user me-2 fs-5"></i><span>${currentUserName}</span>`;
    }

    // ROLE BASED UI ADJUSTMENTS
    if (isAnyAdmin(user.email)) {
        const bulkNav = document.getElementById('bulkImportNav');
        if (bulkNav) bulkNav.style.display = 'block';
        
        if (adminPanelBtn) adminPanelBtn.style.display = (user.email === ADMIN_ROLES.STATION_4) ? 'flex' : 'none';
        if (returnSection) returnSection.style.display = (user.email === ADMIN_ROLES.STATION_4) ? 'block' : 'none';

        const canExport = (user.email === ADMIN_ROLES.STATION_1 || user.email === ADMIN_ROLES.STATION_4);
        if (exportToolbar) exportToolbar.style.display = canExport ? 'flex' : 'none';
        
        if (t1) t1.style.display = 'none';
        if (t2) t2.style.display = 'none';
        if (t3) t3.style.display = 'none';
        if (t4) t4.style.display = 'none';

        if (user.email === ADMIN_ROLES.STATION_4) {
            if (t1) t1.style.display = 'block';
            if (t2) t2.style.display = 'block';
            if (t3) t3.style.display = 'block';
            if (t4) t4.style.display = 'block';
            document.querySelector('#nav-stn4 button')?.classList.add('active');
            document.getElementById('stn4Pane')?.classList.add('show', 'active');
        } else if (user.email === ADMIN_ROLES.STATION_1) {
            if (t1) t1.style.display = 'block';
            document.querySelector('#nav-stn1 button')?.classList.add('active');
            document.getElementById('stn1Pane')?.classList.add('show', 'active');
        } else if (user.email === ADMIN_ROLES.STATION_2) {
            if (t2) t2.style.display = 'block';
            document.querySelector('#nav-stn2 button')?.classList.add('active');
            document.getElementById('stn2Pane')?.classList.add('show', 'active');
        } else if (user.email === ADMIN_ROLES.STATION_3) {
            if (t3) t3.style.display = 'block';
            document.querySelector('#nav-stn3 button')?.classList.add('active');
            document.getElementById('stn3Pane')?.classList.add('show', 'active');
        }

        if (borrowerInput) {
            borrowerInput.readOnly = false;
            borrowerInput.style.backgroundColor = '#fff';
        }
        if (issueBtn) issueBtn.innerText = "ISSUE GATE PASS";
        if (guardInput) guardInput.placeholder = "Guard Name (Optional)";

    } else {
        if (window.location.href.includes('admin')) { window.location.href = 'dashboard.html'; return; }

        if (returnSection) returnSection.style.display = 'none';
        if (exportToolbar) exportToolbar.style.display = 'none';

        if (t1) t1.style.display = 'block';
        if (t2) t2.style.display = 'block';
        if (t3) t3.style.display = 'block';
        if (t4) t4.style.display = 'block';
        
        document.querySelector('#nav-stn1 button')?.classList.add('active');
        document.getElementById('stn1Pane')?.classList.add('show', 'active');

        if (borrowerInput) {
            borrowerInput.value = currentUserName;
            borrowerInput.readOnly = true;
            borrowerInput.style.backgroundColor = '#e9ecef';
        }
        
        if (issueBtn) {
            issueBtn.innerText = "SUBMIT REQUEST";
            issueBtn.classList.remove('btn-primary');
            issueBtn.classList.add('btn-success');
        }

        if (guardInput) {
            guardInput.placeholder = "To be assigned by Admin";
            guardInput.readOnly = true;
            guardInput.style.backgroundColor = '#f8f9fa';
        }

        const issuanceTitle = document.getElementById('issuanceTitle');
        if(issuanceTitle) issuanceTitle.innerText = "Request Gate Pass";
    }
    
    if(document.getElementById('activeTableBody')) {
        loadAllRecords(user);
        loadInventory(); 
        updateClock();
        initSearchListeners(); 
    }
}

function updateClock() {
    const timeEl = document.getElementById('clockTime');
    const dateEl = document.getElementById('clockDate');
    if(!timeEl) return;
    setInterval(() => {
        const now = new Date();
        dateEl.innerText = now.toDateString();
        timeEl.innerText = now.toLocaleTimeString();
    }, 1000);
}

document.getElementById('addToCartBtn')?.addEventListener('click', () => {
    const s = document.getElementById('serial').value;
    const p = document.getElementById('propertyNum').value;
    const d = document.getElementById('desc').value;
    const a = document.getElementById('asset').value;

    if (!s || !d) return alert("Fill Serial/Desc");
    if (cart.some(i => i.serial === s)) return alert("Already in list");

    if (borrowedSerials.has(s)) {
        return alert(`Item ${s} is currently MARKED AS OUT or PENDING APPROVAL.`);
    }

    cart.push({ serial: s, property_no: p, desc: d, asset: a });
    renderCart();
    
    document.getElementById('serial').value=""; 
    document.getElementById('propertyNum').value=""; 
    document.getElementById('desc').value=""; 
    document.getElementById('asset').value="";
});

function renderCart() {
    const tbody = document.getElementById('cartTableBody');
    if (!tbody) return;
    tbody.innerHTML = cart.length === 0 ? '<tr><td colspan="5" class="text-center text-muted py-3">Cart is empty</td></tr>' : "";
    cart.forEach((item, i) => {
        tbody.innerHTML += `<tr><td>${item.serial}</td><td>${item.property_no||'-'}</td><td>${item.desc}</td><td>${item.asset}</td><td class="text-center"><button onclick="window.removeItem(${i})" class="btn btn-sm btn-danger py-0">&times;</button></td></tr>`;
    });
    
    const issueBtn = document.getElementById('issueBtn');
    if(issueBtn) issueBtn.disabled = cart.length === 0;
}
window.removeItem = (i) => { 
    cart.splice(i, 1); 
    renderCart(); 
}

// ==========================================
// INVENTORY LOOKUP MODAL & BULK ADD FIXES
// ==========================================

document.getElementById('btnOpenInventoryLookup')?.addEventListener('click', () => {
    const modalEl = document.getElementById('inventoryLookupModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
});

document.getElementById('btnBulkAdd')?.addEventListener('click', handleBulkAdd);

document.getElementById('inventoryCategoryFilter')?.addEventListener('change', () => {
    const term = document.getElementById('inventorySearchInput').value;
    renderInventoryLookupTable(term);
});

// Helper: Unified Category Detection
function detectItemCategory(description) {
    const d = (description || "").toLowerCase();
    
    // 1. Laptops
    if (d.includes('laptop') || d.includes('macbook') || d.includes('notebook') || 
        d.includes('thinkpad') || d.includes('latitude') || d.includes('elitebook') || 
        d.includes('probook') || d.includes('chromebook')) {
        return 'Laptops';
    }
    
    // 2. Tablets (Check specific brands/models first, then generic 'tablet'. Avoid loose 'tab')
    if (d.includes('tablet') || d.includes('ipad') || d.includes('galaxy tab') || 
        d.includes('lenovo tab') || d.includes(' tab ')) {
        return 'Tablets';
    }

    // 3. Desktops
    if (d.includes('desktop') || d.includes('system unit') || d.includes('cpu') || 
        d.includes('mac mini') || d.includes('imac') || d.includes('workstation') || 
        d.includes('optiplex') || d.includes('all-in-one') || d.includes('aio')) {
        return 'Desktops'; // Maps to 'Desktops & CPUs' in dropdown
    }

    // 4. Monitors
    if (d.includes('monitor') || d.includes('display') || d.includes('screen') || 
        d.includes('led monitor') || d.includes('lcd monitor')) {
        return 'Monitors';
    }

    // 5. Peripherals
    if (d.includes('printer') || d.includes('scanner') || d.includes('projector') || 
        d.includes('keyboard') || d.includes('mouse') || d.includes('router') || 
        d.includes('switch') || d.includes('webcam')) {
        return 'Peripherals';
    }

    return 'Others';
}

// --- UPDATED FUNCTION: UPDATE DROPDOWN COUNTS (FIXED 1000 LIMIT) ---
window.loadInventoryStats = async () => {
    // 1. Refresh borrowed status (Paginated)
    await updateBorrowedStatus();

    // 2. Fetch all inventory (Paginated to bypass 1000 limit)
    let allItems = [];
    let from = 0;
    const limit = 1000;
    let fetching = true;

    while (fetching) {
        const { data, error } = await supabase
            .from('inventory')
            .select('serial, description')
            .range(from, from + limit - 1);

        if (error || !data || data.length === 0) {
            fetching = false;
        } else {
            allItems = allItems.concat(data);
            if (data.length < limit) {
                fetching = false;
            } else {
                from += limit;
            }
        }
    }

    if (allItems.length === 0) return;

    // 3. Filter for AVAILABLE items
    const availableItems = allItems.filter(item => 
        !borrowedSerials.has(item.serial) && 
        !cart.some(c => c.serial === item.serial)
    );

    // 4. Count by Category using Unified Logic
    const counts = {
        'All': availableItems.length,
        'Tablets': 0,
        'Laptops': 0,
        'Desktops': 0, // Maps to 'Desktops & CPUs' in dropdown
        'Monitors': 0,
        'Peripherals': 0
    };

    availableItems.forEach(item => {
        const cat = detectItemCategory(item.description);
        if (counts.hasOwnProperty(cat)) {
            counts[cat]++;
        }
    });

    // 5. Update Dropdown Option Text
    const select = document.getElementById('inventoryCategoryFilter');
    if (select) {
        const labels = {
            'All': 'All Categories',
            'Tablets': 'Tablets',
            'Laptops': 'Laptops',
            'Desktops': 'Desktops & CPUs',
            'Monitors': 'Monitors',
            'Peripherals': 'Peripherals'
        };

        Array.from(select.options).forEach(opt => {
            const baseLabel = labels[opt.value];
            if (baseLabel) {
                // Logic check: Dropdown value matches keys in our 'counts' object directly
                const countKey = opt.value; 
                const count = counts[countKey] || 0;
                opt.text = `${baseLabel} (${count})`;
            }
        });
    }
};

const lookupModalEl = document.getElementById('inventoryLookupModal');
if (lookupModalEl) {
    lookupModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('inventorySearchInput');
        if(input) {
            input.value = '';
            input.focus();
            
            const filterEl = document.getElementById('inventoryCategoryFilter');
            if (filterEl) filterEl.value = 'All';
            
            // Reset Bulk Inputs
            document.getElementById('bulkCategorySelect').value = '';
            document.getElementById('bulkBrandInput').value = '';
            document.getElementById('bulkQtyInput').value = '1';
            document.getElementById('bulkStatusMsg').innerText = "Select a type, optionally type a brand, and choose quantity.";
            
            renderInventoryLookupTable('');
            window.loadInventoryStats();
        }
    });
}

async function handleBulkAdd() {
    const category = document.getElementById('bulkCategorySelect').value;
    const brand = document.getElementById('bulkBrandInput').value.trim();
    const qtyInput = document.getElementById('bulkQtyInput');
    const msgEl = document.getElementById('bulkStatusMsg');
    const qty = parseInt(qtyInput.value);

    if (!category && !brand) return alert("Please select a Category OR type a specific Brand.");
    if (!qty || qty < 1) return alert("Please enter a valid quantity.");
    
    msgEl.innerText = "Searching for available items...";
    msgEl.className = "small text-primary mt-1 fw-bold";
    
    const btn = document.getElementById('btnBulkAdd');
    btn.disabled = true; 

    try {
        let query = supabase.from('inventory').select('*');

        if (category) {
            const catMap = {
                'Tablets': 'description.ilike.%tablet%,description.ilike.%ipad%,description.ilike.%galaxy tab%,description.ilike.%tab %',
                'Laptops': 'description.ilike.%laptop%,description.ilike.%macbook%,description.ilike.%notebook%,description.ilike.%thinkpad%',
                'Desktops': 'description.ilike.%desktop%,description.ilike.%system unit%,description.ilike.%cpu%,description.ilike.%mac mini%,description.ilike.%imac%',
                'Monitors': 'description.ilike.%monitor%,description.ilike.%display%',
                'Peripherals': 'description.ilike.%printer%,description.ilike.%scanner%,description.ilike.%projector%'
            };
            const queryStr = catMap[category];
            if (queryStr) query = query.or(queryStr);
        }

        if (brand) {
            query = query.ilike('description', `%${brand}%`);
        }

        const { data, error } = await query
            .order('description', { ascending: true }) 
            .order('serial', { ascending: true })     
            .limit(100); 

        if (error) throw error;

        const availableItems = (data || []).filter(i => 
            !borrowedSerials.has(i.serial) && 
            !cart.some(c => c.serial === i.serial)
        );

        if (availableItems.length === 0) {
            msgEl.innerText = "No available items found matching criteria.";
            msgEl.className = "small text-danger mt-1 fw-bold";
            btn.disabled = false;
            return;
        }

        const itemsToAdd = availableItems.slice(0, qty);
        itemsToAdd.forEach(item => {
            cart.push({
                serial: item.serial,
                property_no: item.property_no,
                desc: item.description,
                asset: item.asset_no
            });
        });

        renderCart();
        const addedCount = itemsToAdd.length;
        let successText = `Added ${addedCount} items`;
        if (category) successText += ` (${category})`;
        if (brand) successText += ` matching "${brand}"`;

        if (addedCount < qty) {
            msgEl.innerText = `${successText} (Only ${addedCount} available).`;
            msgEl.className = "small text-warning mt-1 fw-bold";
        } else {
            msgEl.innerText = `Successfully ${successText}!`;
            msgEl.className = "small text-success mt-1 fw-bold";
        }
        qtyInput.value = 1;
        window.loadInventoryStats(); 

    } catch (e) {
        msgEl.innerText = "Error: " + e.message;
        msgEl.className = "small text-danger mt-1";
    } finally {
        btn.disabled = false;
    }
}

document.getElementById('inventorySearchInput')?.addEventListener('input', (e) => {
    renderInventoryLookupTable(e.target.value);
});

async function renderInventoryLookupTable(filterTerm) {
    const tbody = document.getElementById('inventoryLookupBody');
    if (!tbody) return;
    
    const categoryVal = document.getElementById('inventoryCategoryFilter')?.value || 'All';

    clearTimeout(searchDebounceTimer);

    if (filterTerm.length > 0 || categoryVal !== 'All') {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Searching...</td></tr>';
    }

    searchDebounceTimer = setTimeout(async () => {
        try {
            let query = supabase.from('inventory').select('*').limit(50); 

            // SQL filtering for initial fetch (optimization)
            if (categoryVal !== 'All') {
                const catMap = {
                    'Tablets': 'description.ilike.%tablet%,description.ilike.%ipad%,description.ilike.%galaxy tab%,description.ilike.%tab %',
                    'Laptops': 'description.ilike.%laptop%,description.ilike.%macbook%,description.ilike.%notebook%,description.ilike.%thinkpad%',
                    'Desktops': 'description.ilike.%desktop%,description.ilike.%system unit%,description.ilike.%cpu%',
                    'Monitors': 'description.ilike.%monitor%,description.ilike.%display%',
                    'Peripherals': 'description.ilike.%printer%,description.ilike.%scanner%,description.ilike.%projector%'
                };
                if (catMap[categoryVal]) {
                    query = query.or(catMap[categoryVal]);
                }
            }

            if (filterTerm) {
                query = query.or(`serial.ilike.%${filterTerm}%,description.ilike.%${filterTerm}%,asset_no.ilike.%${filterTerm}%`);
            } else {
                if (categoryVal === 'All') query = query.order('serial', { ascending: true }); 
            }

            const { data, error } = await query;
            if (error) throw error;

            tbody.innerHTML = '';
            
            const availableItems = (data || []).filter(i => 
                !borrowedSerials.has(i.serial) && 
                !cart.some(c => c.serial === i.serial)
            );

            if (availableItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No available items found.</td></tr>';
                return;
            }

            currentSearchResults = availableItems;

            // USE THE UNIFIED FUNCTION HERE
            const getCategoryIcon = (cat) => {
                const map = {
                    'Tablets': 'fa-tablet-screen-button',
                    'Laptops': 'fa-laptop',
                    'Desktops': 'fa-computer',
                    'Monitors': 'fa-display',
                    'Peripherals': 'fa-print',
                    'Others': 'fa-box-open'
                };
                return map[cat] || 'fa-box';
            };

            const catOrder = { 'Tablets': 1, 'Laptops': 2, 'Desktops': 3, 'Monitors': 4, 'Peripherals': 5, 'Others': 6 };

            availableItems.sort((a, b) => {
                const catA = detectItemCategory(a.description); // Use shared function
                const catB = detectItemCategory(b.description);
                if (catOrder[catA] !== catOrder[catB]) {
                    return (catOrder[catA] || 99) - (catOrder[catB] || 99);
                }
                return (a.description || "").localeCompare(b.description || "");
            });

            let lastCategory = "";
            availableItems.forEach(item => {
                const currentCategory = detectItemCategory(item.description); // Use shared function
                
                // Group Header
                if (currentCategory !== lastCategory) {
                    let displayCat = currentCategory;
                    if(displayCat === 'Desktops') displayCat = 'Desktops & CPUs';
                    if(displayCat === 'Others') displayCat = 'Accessories & Others';

                    const iconClass = getCategoryIcon(currentCategory);
                    tbody.innerHTML += `
                        <tr class="table-light border-bottom border-2 sticky-top" style="top: 0; z-index: 1;">
                            <td colspan="4" class="fw-bold text-primary small text-uppercase px-3 py-2 bg-light shadow-sm">
                                <i class="fa ${iconClass} me-2"></i>${displayCat}
                            </td>
                        </tr>
                    `;
                    lastCategory = currentCategory;
                }

                tbody.innerHTML += `
                    <tr style="cursor: pointer;" onclick="window.selectInventoryItem('${item.serial}')" class="align-middle">
                        <td class="ps-4">
                            <div class="d-flex align-items-center">
                                <div class="bg-light rounded p-2 me-3 text-secondary border d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
                                    <i class="fa ${getCategoryIcon(currentCategory)} fa-lg"></i>
                                </div>
                                <div>
                                    <div class="fw-bold text-dark font-monospace text-nowrap">${item.serial}</div>
                                    <div class="small text-muted d-md-none text-truncate" style="max-width: 150px;">${item.description}</div>
                                </div>
                            </div>
                        </td>
                        <td class="d-none d-md-table-cell w-50">
                            <small class="fw-semibold text-secondary text-wrap">${item.description}</small>
                        </td>
                        <td><span class="badge bg-white text-secondary border shadow-sm">${item.asset_no || '<span class="text-muted opacity-50">N/A</span>'}</span></td>
                        <td class="text-end pe-3">
                            <button class="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold">
                                Select <i class="fa fa-arrow-right ms-1"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });

        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Error fetching data. Check connection.</td></tr>';
        }
    }, 300); 
}

window.selectInventoryItem = (serial) => {
    const item = currentSearchResults.find(i => i.serial === serial);
    
    if (item) {
        document.getElementById('serial').value = item.serial;
        document.getElementById('desc').value = item.description;
        document.getElementById('asset').value = item.asset_no;
        if(document.getElementById('propertyNum')) document.getElementById('propertyNum').value = item.property_no;
        
        const modalEl = document.getElementById('inventoryLookupModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
};

// ==========================================
// CORE: ISSUE / REQUEST HANDLER
// ==========================================
document.getElementById('issueBtn')?.addEventListener('click', async () => {
    const borrower = document.getElementById('borrower').value;
    const guard = document.getElementById('guardOut').value;
    const dest = document.getElementById('destination').value;
    const proj = document.getElementById('project').value;
    const due = document.getElementById('dueDate').value;

    if (!borrower || !dest || !due) return alert("Fill all required fields (Borrower, Destination, Due Date).");
    
    const isAdmin = isAnyAdmin(currentUser.email);

    for (const item of cart) {
        if (borrowedSerials.has(item.serial)) return alert(`Serial ${item.serial} is currently PENDING or OUT.`);
    }
    
    const actionType = isAdmin ? "ISSUE" : "REQUEST";
    const msg = isAdmin ? `Proceed to create ${cart.length} items in 'For Release' list?` : `Submit request for ${cart.length} items?`;

    if (!await showConfirm(actionType, msg)) return;

    try {
        const batchID = await getNextGatePassID();
        
        const { data: { user } } = await supabase.auth.getUser();
        
        let initialStatus = "PENDING_PROPERTY";
        if (user.email === ADMIN_ROLES.STATION_4) {
             initialStatus = "RELEASING";
        }
        
        const records = cart.map(item => ({
            unique_id: batchID,
            issuer_email: user.email,
            borrower, 
            guard_out: guard || "TBD", 
            destination: dest, 
            project: proj, 
            due_date: due,
            serial: item.serial, 
            property_no: item.property_no, 
            description: item.desc, 
            asset_no: item.asset,
            time_out: null, 
            status: initialStatus, 
            time_return: null
        }));

        const { error } = await supabase.from('gate_passes').insert(records);
        if (error) throw error;

        const successMsg = (user.email === ADMIN_ROLES.STATION_4) 
            ? `Batch ${batchID} created in 'For Release' tab.`
            : `Request Submitted! ID: ${batchID} - Waiting for Property Approval.`;

        alert(successMsg);
        
        cart = []; renderCart();
        
        if (isAdmin) document.getElementById('borrower').value = "";
        window.refreshTableData();
        
        // Navigation auto-switch to Approvals View
        document.querySelector('.nav-item-btn[data-target="view-approvals"]')?.click();
        
        // SAFE Tab switching
        if (!isAdmin || user.email !== ADMIN_ROLES.STATION_4) {
             const tabEl = document.querySelector('#approvalTabs button[data-bs-target="#stn1Pane"]');
             if(tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();
        } else {
             const tabEl = document.querySelector(`#approvalTabs button[data-bs-target="#stn4Pane"]`);
             if(tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();
        }

    } catch(e) { alert(e.message); }
});

async function loadInventory() {
    const sInput = document.getElementById('serial');
    if(sInput) {
        sInput.setAttribute('autocomplete', 'off'); 
        sInput.removeAttribute('list'); 
    }
    updateBorrowedStatus();
}

// --- UPDATED FUNCTION: FETCH BORROWED STATUS (FIXED 1000 LIMIT) ---
async function updateBorrowedStatus() {
    let allBorrowed = [];
    let from = 0;
    const limit = 1000;
    let fetching = true;

    while (fetching) {
        const { data, error } = await supabase.from('gate_passes')
            .select('serial')
            .in('status', ['OUT', 'RELEASING', 'PENDING_PROPERTY', 'PENDING_INSPECTION', 'PENDING_OIC'])
            .range(from, from + limit - 1);
        
        if (error || !data || data.length === 0) {
            fetching = false;
        } else {
            allBorrowed = allBorrowed.concat(data);
            if (data.length < limit) {
                fetching = false;
            } else {
                from += limit;
            }
        }
    }
        
    if(allBorrowed.length > 0) {
        borrowedSerials = new Set(allBorrowed.map(d => d.serial));
    } else {
        borrowedSerials = new Set();
    }
}

document.getElementById('serial')?.addEventListener('change', (e) => {
    if(e.target.value.length > 3) {
        supabase.from('inventory').select('*').eq('serial', e.target.value).single()
        .then(({data}) => {
            if(data) {
                document.getElementById('desc').value = data.description;
                document.getElementById('asset').value = data.asset_no;
                if(document.getElementById('propertyNum')) document.getElementById('propertyNum').value = data.property_no;
            }
        });
    }
});

function loadAllRecords(user) {
    const isAdmin = isAnyAdmin(user.email);
    
    const fetchRecords = async () => {
        try {
            const selectedBatchesActive = getSelectedIds('activeTableBody');
            const selectedBatchesHistory = getSelectedIds('historyTableBody');
            const selectedBatchesReleasing = getSelectedIds('releasingTableBody'); 
            
            const buildQuery = (status) => {
                let q = supabase.from('gate_passes').select('*').eq('status', status);
                if (!isAdmin) {
                    q = q.or(`issuer_email.eq."${user.email}",borrower.eq."${currentUserName}"`);
                }
                return q;
            };

            const { data: aData } = await buildQuery('OUT').order('time_out', { ascending: false }).limit(500);
            if(aData) {
                activeData = aData;
                populateReturnSelector(); // Populate dropdown when active data loads
            }

            const { data: hData } = await buildQuery('RETURNED').order('time_return', { ascending: false }).limit(500);
            if(hData) historyData = hData;

            const { data: s1Data } = await buildQuery('PENDING_PROPERTY').order('id', { ascending: false });
            if(s1Data) station1Data = s1Data;

            const { data: s2Data } = await buildQuery('PENDING_INSPECTION').order('id', { ascending: false });
            if(s2Data) station2Data = s2Data;

            const { data: s3Data } = await buildQuery('PENDING_OIC').order('id', { ascending: false });
            if(s3Data) station3Data = s3Data;

            const { data: rData } = await buildQuery('RELEASING').order('id', { ascending: false });
            if(rData) releasingData = rData;

            // ---------------------------------------------------------------------------------
            // NEW: AUTO-CLEANUP MECHANISM
            // Fetch denied items for notifications (Matches all users' own rejected items)
            const { data: rjData } = await supabase.from('gate_passes')
                .select('*')
                .eq('status', 'REJECTED')
                .or(`issuer_email.eq."${user.email}",borrower.eq."${currentUserName}"`);

            if (rjData && rjData.length > 0) {
                // 1. Save to browser's local memory so the user doesn't lose the notification
                let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + user.email) || '[]');
                const newNotifs = rjData.filter(dbItem => !localNotifs.some(local => local.id === dbItem.id));
                
                if (newNotifs.length > 0) {
                    localNotifs = [...localNotifs, ...newNotifs];
                    localStorage.setItem('psa_notifications_' + user.email, JSON.stringify(localNotifs));
                }
                
                // 2. IMMEDIATELY DELETE FROM DATABASE to prevent clogging!
                // Even if the user ignores the bell icon, the database is already cleaned up.
                const idsToDelete = rjData.map(i => i.id);
                if (idsToDelete.length > 0) {
                    await supabase.from('gate_passes').delete().in('id', idsToDelete);
                }
            }
            // ---------------------------------------------------------------------------------

            renderTable('active');
            renderTable('history');
            
            const canApproveStn1 = (user.email === ADMIN_ROLES.STATION_1);
            const canApproveStn2 = (user.email === ADMIN_ROLES.STATION_2);
            const canApproveStn3 = (user.email === ADMIN_ROLES.STATION_3);
            const canReleaseStn4 = (user.email === ADMIN_ROLES.STATION_4);

            renderStationTable(station1Data, 'station1TableBody', 'badgeStation1', 'PENDING_PROPERTY', canApproveStn1);
            renderStationTable(station2Data, 'station2TableBody', 'badgeStation2', 'PENDING_INSPECTION', canApproveStn2);
            renderStationTable(station3Data, 'station3TableBody', 'badgeStation3', 'PENDING_OIC', canApproveStn3);
            renderReleasingTable(canReleaseStn4);

            const restoreSelection = (tbodyId, ids) => {
                if(ids.length) {
                    const boxes = document.querySelectorAll(`#${tbodyId} .export-check`);
                    boxes.forEach(b => { if(ids.includes(b.value)) b.checked = true; });
                }
            };
            restoreSelection('activeTableBody', selectedBatchesActive);
            restoreSelection('historyTableBody', selectedBatchesHistory);
            restoreSelection('releasingTableBody', selectedBatchesReleasing); 
            
            updateUnifiedSelectionCount();
            updateNavBadges(user); 

        } catch (e) { console.error("Error fetching records:", e); }
    };

    window.refreshTableData = () => {
        lastStation1Signature = ""; lastStation2Signature = ""; lastStation3Signature = "";
        lastReleasingSignature = ""; lastActiveSignature = ""; lastHistorySignature = "";
        lastRejectedSignature = ""; lastSelectorSignature = ""; // Reset selector signature
        fetchRecords();
        updateBorrowedStatus();
    };

    fetchRecords();

    setInterval(() => {
        if (!document.hidden) {
            fetchRecords();
            updateBorrowedStatus();
        }
    }, 5000);
}

function populateReturnSelector() {
    const selector = document.getElementById('returnBatchID');
    if (!selector) return;

    // Filter activeData to get unique batches
    const batches = activeData.reduce((acc, item) => {
        if (!acc[item.unique_id]) {
            acc[item.unique_id] = { id: item.unique_id, borrower: item.borrower };
        }
        return acc;
    }, {});

    const currentSignature = JSON.stringify(Object.keys(batches).sort());
    if (currentSignature === lastSelectorSignature) return;
    lastSelectorSignature = currentSignature;

    const previousVal = selector.value;
    selector.innerHTML = '<option value="" selected disabled>Select Batch to Return...</option>';
    
    // Sort batches by ID descending (newest first)
    Object.values(batches).sort((a,b) => b.id.localeCompare(a.id)).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.text = `${b.id} - ${b.borrower}`;
        selector.appendChild(opt);
    });

    if (previousVal && batches[previousVal]) selector.value = previousVal;
}

// ==========================================
// NOTIFICATIONS & BADGES
// ==========================================
function updateNavBadges(user) {
    const approvalsBtn = document.querySelector('.nav-item-btn[data-target="view-approvals"]');
    if(approvalsBtn) {
        let count = 0;
        if(isAnyAdmin(user.email)) {
            // Admins see count for their specific queue
            if(user.email === ADMIN_ROLES.STATION_1) count = station1Data.length;
            else if(user.email === ADMIN_ROLES.STATION_2) count = station2Data.length;
            else if(user.email === ADMIN_ROLES.STATION_3) count = station3Data.length;
            else if(user.email === ADMIN_ROLES.STATION_4) count = releasingData.length;
        } else {
            // Standard users see count of ALL their pending batches
            const userPending = [...station1Data, ...station2Data, ...station3Data, ...releasingData];
            const uniqueBatches = new Set(userPending.map(item => item.unique_id));
            count = uniqueBatches.size; 
        }

        let badge = approvalsBtn.querySelector('.badge');
        if(!badge) {
            badge = document.createElement('span');
            badge.className = 'badge bg-danger rounded-pill ms-2';
            approvalsBtn.appendChild(badge);
        }
        badge.innerText = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }

    // Always process notification bell reading from local storage
    renderNotifications();
}

function renderNotifications() {
    const localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + currentUser.email) || '[]');
    const currentSignature = JSON.stringify(localNotifs);
    if(currentSignature === lastRejectedSignature) return; // Prevent unnecessary DOM work
    lastRejectedSignature = currentSignature;

    const rejectedBatches = new Set(localNotifs.map(item => item.unique_id));
    const count = rejectedBatches.size;

    let notifBtn = document.getElementById('userNotifBtn');
    if(!notifBtn && count > 0) {
        const userDisplay = document.getElementById('currentUserDisplay');
        if(userDisplay) {
            notifBtn = document.createElement('button');
            notifBtn.id = 'userNotifBtn';
            notifBtn.className = 'btn btn-link text-dark position-relative me-3 p-0 border-0 text-decoration-none';
            notifBtn.innerHTML = `<i class="fa fa-bell fs-5"></i><span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" id="notifBadge" style="font-size: 0.6rem;">0</span>`;
            notifBtn.onclick = showNotificationsModal;
            userDisplay.parentNode.insertBefore(notifBtn, userDisplay);
        }
    }

    if(notifBtn) {
        const badge = document.getElementById('notifBadge');
        if(badge) {
            badge.innerText = count;
            badge.style.display = count > 0 ? 'block' : 'none';
        }
    }
}

function showNotificationsModal() {
    let modalEl = document.getElementById('notificationsModal');
    if(!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'notificationsModal';
        modalEl.className = 'modal fade';
        modalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fa fa-bell me-2"></i> Notifications</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="notifModalBody" style="max-height: 60vh; overflow-y: auto;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
    }

    const localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + currentUser.email) || '[]');
    const body = document.getElementById('notifModalBody');
    
    const rejectedGroups = localNotifs.reduce((acc, item) => {
        if(!acc[item.unique_id]) acc[item.unique_id] = { id: item.unique_id, items: [] };
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    if(Object.keys(rejectedGroups).length === 0) {
        body.innerHTML = `<p class="text-muted text-center mb-0 p-3">No new notifications.</p>`;
    } else {
        body.innerHTML = Object.values(rejectedGroups).map(g => `
            <div class="alert alert-warning mb-2 border-warning d-flex justify-content-between align-items-center shadow-sm">
                <div>
                    <h6 class="mb-1 text-danger fw-bold"><i class="fa fa-ban me-1"></i> Batch ${g.id} Denied</h6>
                    <small class="text-dark">Your request for ${g.items.length} item(s) was rejected by the administration.</small>
                </div>
                <button class="btn btn-sm btn-outline-danger ms-3" onclick="window.dismissRejection('${g.id}')">Dismiss</button>
            </div>
        `).join('');
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

window.dismissRejection = async (batchId) => {
    if(!confirm("Acknowledge and clear this notification?")) return;
    try {
        // Since we already deleted it from the database automatically during the fetch process,
        // we only need to remove it from the local browser storage here.
        let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + currentUser.email) || '[]');
        localNotifs = localNotifs.filter(item => item.unique_id !== batchId);
        localStorage.setItem('psa_notifications_' + currentUser.email, JSON.stringify(localNotifs));
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('notificationsModal'));
        if(modal) modal.hide();
        renderNotifications(); // instantly update UI
    } catch(e) { alert(e.message); }
};

function getSelectedIds(tbodyId) {
    const checked = document.querySelectorAll(`#${tbodyId} .export-check:checked`);
    return Array.from(checked).map(cb => cb.value); 
}

// ==========================================
// RENDER GENERIC STATION TABLE
// ==========================================
function renderStationTable(data, tbodyId, badgeId, currentStatus, canApprove) {
    const tbody = document.getElementById(tbodyId);
    const badge = document.getElementById(badgeId);
    if(!tbody) return;

    // --- FIX FOR ACCORDION REFRESH ISSUE ---
    const currentSignature = JSON.stringify(data);
    if (currentStatus === 'PENDING_PROPERTY') {
        if (currentSignature === lastStation1Signature && tbody.innerHTML.trim() !== "") return;
        lastStation1Signature = currentSignature;
    } else if (currentStatus === 'PENDING_INSPECTION') {
        if (currentSignature === lastStation2Signature && tbody.innerHTML.trim() !== "") return;
        lastStation2Signature = currentSignature;
    } else if (currentStatus === 'PENDING_OIC') {
        if (currentSignature === lastStation3Signature && tbody.innerHTML.trim() !== "") return;
        lastStation3Signature = currentSignature;
    }

    const openAccordions = Array.from(document.querySelectorAll(`#${tbodyId} .collapse.show`)).map(el => el.id);
    // ---------------------------------------

    let config = { btnText: "Approve", nextStation: "Next Station", badgeClass: "bg-secondary", borderClass: "border-secondary", bgClass: "table-secondary" };
    if (currentStatus === 'PENDING_PROPERTY') {
        config = { btnText: "Approve (Property)", nextStation: "Inspection", badgeClass: "bg-secondary", borderClass: "border-secondary", bgClass: "table-secondary" };
    } else if (currentStatus === 'PENDING_INSPECTION') {
        config = { btnText: "Approve (Inspection)", nextStation: "OIC", badgeClass: "bg-info", borderClass: "border-info", bgClass: "table-info" };
    } else if (currentStatus === 'PENDING_OIC') {
        config = { btnText: "Approve (OIC)", nextStation: "For Release", badgeClass: "bg-warning", borderClass: "border-warning", bgClass: "table-warning" };
    }

    if (badge) {
        if (data.length > 0) {
            badge.innerText = data.length;
            badge.classList.remove('d-none');
            if(canApprove) badge.classList.add('badge-pulse');
        } else {
            badge.classList.add('d-none');
            badge.classList.remove('badge-pulse');
        }
    }

    tbody.innerHTML = "";
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No requests in this station.</td></tr>`;
        return;
    }

    const canExportHere = (currentUser.email === ADMIN_ROLES.STATION_1 || currentUser.email === ADMIN_ROLES.STATION_4);

    const groups = data.reduce((acc, item) => {
        if (!acc[item.unique_id]) {
            acc[item.unique_id] = { id: item.unique_id, borrower: item.borrower, project: item.project, date: item.due_date, status: item.status, items: [], destination: item.destination };
        }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    Object.values(groups).forEach(group => {
        const batchId = group.id;
        const itemCount = group.items.length;
        const safeBatchId = batchId.replace(/[^a-zA-Z0-9]/g, "_") + "_" + currentStatus; 

        let actionBtns = '';
        if (canApprove) {
            actionBtns = `
                <button class="btn btn-primary btn-sm me-1 fw-bold" onclick="window.approveBatch('${batchId}', '${currentStatus}')">
                    <i class="fa fa-arrow-right me-1"></i> ${config.btnText}
                </button>
                <button class="btn btn-danger btn-sm" onclick="window.rejectBatch('${batchId}', '${currentStatus}')">
                    <i class="fa fa-times"></i>
                </button>`;
        } else {
             actionBtns = `<button class="btn btn-outline-secondary btn-sm" onclick="window.rejectBatch('${batchId}', '${currentStatus}')" style="font-size: 0.7rem;">Cancel Request</button>`;
        }

        if (canExportHere) {
            actionBtns += `<button class="btn btn-outline-success btn-sm ms-1" onclick="window.triggerExportModal('${batchId}', '${currentStatus}')" title="Export this batch"><i class="fa fa-file-export"></i></button>`;
        }

        const summaryRow = `
            <tr class="table-light border-bottom border-2 ${config.borderClass}">
                <td class="fw-bold text-primary">
                    <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${safeBatchId}" aria-expanded="false">
                        <i class="fa fa-chevron-right me-2 small"></i>${batchId}
                    </button>
                </td>
                <td class="fw-bold">${group.borrower}</td>
                <td><span class="badge ${config.badgeClass} text-dark">${itemCount} Items</span></td>
                <td>${group.destination}</td>
                <td>${group.project}</td>
                <td>${group.date}</td>
                <td class="text-center text-nowrap">${actionBtns}</td>
            </tr>`;
        
        const itemRows = group.items.map(item => `
            <tr>
                <td class="text-muted ps-4"><small>${item.serial}</small></td>
                <td colspan="2"><small>${item.description}</small></td>
                <td><small>${item.asset_no || '-'}</small></td>
                <td colspan="2"><small class="text-muted">Prop No: ${item.property_no || '-'}</small></td>
                <td class="text-center">
                    ${canApprove ? `<button class="btn btn-outline-danger btn-sm py-0" style="font-size:0.7rem" onclick="window.rejectRequest('${item.id}')">Reject Item</button>` : ''}
                </td>
            </tr>`).join('');

        tbody.innerHTML += summaryRow + `<tr><td colspan="8" class="p-0 border-0"><div class="collapse bg-white" id="collapse-${safeBatchId}"><table class="table table-sm mb-0 table-borderless bg-light bg-opacity-10"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th colspan="2">Description</th><th>Asset</th><th colspan="2">Property No</th><th class="text-center">Action</th></tr></thead><tbody>${itemRows}</tbody></table></div></td></tr>`;
    });

    // --- RESTORE OPEN ACCORDIONS ---
    openAccordions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('show');
            const btn = document.querySelector(`button[data-bs-target="#${id}"]`);
            if(btn) btn.setAttribute('aria-expanded', 'true');
        }
    });
}

function renderReleasingTable(canRelease) {
    const tbody = document.getElementById('releasingTableBody');
    const badge = document.getElementById('releasingCountBadge');
    if(!tbody) return;

    const currentSignature = JSON.stringify(releasingData);
    if (currentSignature === lastReleasingSignature && tbody.innerHTML.trim() !== "") return;
    
    const openAccordions = Array.from(document.querySelectorAll('#releasingTableBody .collapse.show')).map(el => el.id);
    lastReleasingSignature = currentSignature;
    tbody.innerHTML = "";
    
    if (badge) {
        badge.innerText = releasingData.length;
        badge.classList.toggle('d-none', releasingData.length === 0);
    }

    if (releasingData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No items waiting for release.</td></tr>`;
        return;
    }

    const canSelect = (currentUser.email === ADMIN_ROLES.STATION_1 || currentUser.email === ADMIN_ROLES.STATION_4);

    const groups = releasingData.reduce((acc, item) => {
        if (!acc[item.unique_id]) { acc[item.unique_id] = { id: item.unique_id, borrower: item.borrower, items: [], destination: item.destination, date: item.due_date, project: item.project }; }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    Object.values(groups).forEach(group => {
        const batchId = group.id;
        const safeBatchId = batchId.replace(/[^a-zA-Z0-9]/g, "_");
        
        let actionBtns = '';
        if (canRelease) {
            actionBtns = `
                <button class="btn btn-success btn-sm me-1 fw-bold" onclick="window.confirmReleaseBatch('${batchId}')">
                    <i class="fa fa-box-open me-1"></i> Release
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="window.rejectBatch('${batchId}', 'RELEASING')">
                    <i class="fa fa-ban"></i>
                </button>`;
        } else {
             actionBtns = `<span class="badge bg-primary text-white">Pending Release</span>`;
        }

        // Single row export button
        if (canSelect) {
            actionBtns += `<button class="btn btn-outline-success btn-sm ms-1" onclick="window.triggerExportModal('${batchId}', 'RELEASING')" title="Export this batch"><i class="fa fa-file-export"></i></button>`;
        }

        // Add checkbox for Admin 1 and Admin 4
        const checkboxContent = canSelect ? `<input type="checkbox" class="export-check form-check-input" value="${group.id}">` : `-`;

        const summaryRow = `
            <tr class="table-light border-bottom border-2 border-primary align-middle">
                <td class="text-center">${checkboxContent}</td>
                <td class="fw-bold text-primary">
                    <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-rel-${safeBatchId}">
                        <i class="fa fa-chevron-right me-2 small"></i>${batchId}
                    </button>
                </td>
                <td class="fw-bold">${group.borrower}</td>
                <td><span class="badge bg-secondary">${group.items.length} Items</span></td>
                <td>${group.destination}</td>
                <td>${group.date}</td>
                <td class="text-center text-nowrap">${actionBtns}</td>
            </tr>`;
        
        const itemRows = group.items.map(item => `<tr><td class="text-muted ps-4"><small>${item.serial}</small></td><td colspan="2"><small>${item.description}</small></td><td><small>${item.asset_no || '-'}</small></td><td colspan="2"><small class="text-muted">Prop No: ${item.property_no || '-'}</small></td></tr>`).join('');
        tbody.innerHTML += summaryRow + `<tr><td colspan="8" class="p-0 border-0"><div class="collapse bg-white" id="collapse-rel-${safeBatchId}"><table class="table table-sm mb-0 table-borderless bg-light bg-opacity-10"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th colspan="2">Description</th><th>Asset</th><th colspan="2">Property No</th></tr></thead><tbody>${itemRows}</tbody></table></div></td></tr>`;
    });

    openAccordions.forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('show'); document.querySelector(`button[data-bs-target="#${id}"]`)?.setAttribute('aria-expanded', 'true'); }});
}

// ==========================================
// WORKFLOW ACTIONS
// ==========================================
window.approveBatch = async (batchId, currentStatus) => {
    let nextStatus = '';
    let confirmMsg = '';
    let successMsg = '';
    
    const email = currentUser.email;
    if (currentStatus === 'PENDING_PROPERTY' && email !== ADMIN_ROLES.STATION_1) return alert("Only Property (Station 1) can approve this.");
    if (currentStatus === 'PENDING_INSPECTION' && email !== ADMIN_ROLES.STATION_2) return alert("Only Inspection (Station 2) can approve this.");
    if (currentStatus === 'PENDING_OIC' && email !== ADMIN_ROLES.STATION_3) return alert("Only OIC (Station 3) can approve this.");

    if (currentStatus === 'PENDING_PROPERTY') { nextStatus = 'PENDING_INSPECTION'; confirmMsg = `Move ${batchId} to Inspection?`; successMsg = "Moved to Inspection."; } 
    else if (currentStatus === 'PENDING_INSPECTION') { nextStatus = 'PENDING_OIC'; confirmMsg = `Move ${batchId} to OIC?`; successMsg = "Moved to OIC."; } 
    else if (currentStatus === 'PENDING_OIC') { nextStatus = 'RELEASING'; confirmMsg = `Move ${batchId} to For Release?`; successMsg = "Moved to For Release."; }

    if (!await showConfirm("Approve Request", confirmMsg)) return;

    try {
        const { error } = await supabase.from('gate_passes').update({ status: nextStatus }).eq('unique_id', batchId).eq('status', currentStatus);
        if (error) throw error;
        alert(successMsg);
        window.refreshTableData();
    } catch(e) { alert(e.message); }
};

window.confirmReleaseBatch = async (batchId) => {
    if (currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    const guardName = prompt("Enter Guard Name:");
    if (!guardName) return; 

    if (!await showConfirm("Confirm Release", `Mark ${batchId} as OUT?`)) return;

    try {
        const { error } = await supabase.from('gate_passes').update({
            status: 'OUT', time_out: new Date(), guard_out: guardName, issuer_email: currentUser.email
        }).eq('unique_id', batchId).eq('status', 'RELEASING');
        if (error) throw error;
        alert("Released!");
        window.refreshTableData();
        
        document.querySelector('.nav-item-btn[data-target="view-records"]')?.click();
        const tabEl = document.querySelector('#recordsTabs button[data-bs-target="#activeRecordsTab"]');
        if (tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();
    } catch(e) { alert(e.message); }
};

window.rejectBatch = async (batchId, currentStatus) => {
     if (!await showConfirm("Deny/Reject", `Deny/Reject batch ${batchId}?`)) return;
     try {
        // Change status so the user can pull the notification, then auto-clean up
        const { error } = await supabase.from('gate_passes').update({ status: 'REJECTED' }).eq('unique_id', batchId).eq('status', currentStatus);
        if (error) throw error;
        alert(`Batch Denied. Notification sent.`);
        window.refreshTableData();
     } catch(e) { alert(e.message); }
};

window.rejectRequest = async (id) => {
    if (!await showConfirm("Deny/Reject", "Deny/Reject this specific item?")) return;
    try {
        const { error } = await supabase.from('gate_passes').update({ status: 'REJECTED' }).eq('id', id);
        if (error) throw error;
        alert(`Item denied. Notification sent.`);
        window.refreshTableData();
    } catch(e) { alert(e.message); }
};

function renderTable(type) {
    const state = paginationState[type];
    const rawData = type === 'active' ? activeData : historyData;
    const tbody = document.getElementById(type === 'active' ? 'activeTableBody' : 'historyTableBody');
    if (!tbody) return;
    
    const groups = rawData.reduce((acc, item) => {
        if (!acc[item.unique_id]) { acc[item.unique_id] = { id: item.unique_id, borrower: item.borrower, project: item.project, date: type === 'active' ? item.time_out : item.time_return, guard: type === 'active' ? item.guard_out : item.guard_in, dueDate: item.due_date, items: [] }; }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    let groupArray = Object.values(groups);
    if (state.filter) {
        const term = state.filter.toLowerCase();
        groupArray = groupArray.filter(g => {
            return [g.id, g.borrower, g.project].some(v => v && String(v).toLowerCase().includes(term)) || 
                   g.items.some(i => [i.serial, i.description].some(v => v && String(v).toLowerCase().includes(term)));
        });
    }
    groupArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalItems = groupArray.length;
    const totalPages = Math.ceil(totalItems / state.limit);
    if (state.page > totalPages) state.page = Math.max(1, totalPages);
    
    const start = (state.page - 1) * state.limit;
    const paginatedGroups = groupArray.slice(start, start + state.limit);
    
    const currentSignature = JSON.stringify(paginatedGroups.map(g => ({ id: g.id, count: g.items.length, status: g.items[0]?.status, due: g.dueDate })));
    if (type === 'active') { if (currentSignature === lastActiveSignature && tbody.innerHTML.trim() !== "") return; lastActiveSignature = currentSignature; } 
    else { if (currentSignature === lastHistorySignature && tbody.innerHTML.trim() !== "") return; lastHistorySignature = currentSignature; }

    const openAccordions = Array.from(document.querySelectorAll(`#${tbody.id} .collapse.show`)).map(el => el.id);

    tbody.innerHTML = "";
    if (paginatedGroups.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No records found.</td></tr>`; } 
    else {
        const today = new Date().toISOString().split('T')[0];
        const isAdmin = isAnyAdmin(currentUser.email);
        
        paginatedGroups.forEach(group => {
            const safeBatchId = group.id.replace(/[^a-zA-Z0-9]/g, "_");
            const itemCount = group.items.length;
            
            let statusBadge = '';
            let dueCell = '';

            if (type === 'active') {
                if (group.dueDate && group.dueDate < today) statusBadge = '<span class="badge bg-danger">OVERDUE</span>';
                else if (group.dueDate === today) statusBadge = '<span class="badge bg-warning text-dark">DUE TODAY</span>';
                else statusBadge = '<span class="badge bg-primary">OUT</span>';

                if (isAdmin) {
                    dueCell = `<input type="date" class="form-control form-control-sm border-warning" value="${group.dueDate || ''}" onchange="window.updateBatchDueDate('${group.id}', this.value)" onclick="event.stopPropagation()">`;
                } else { dueCell = group.dueDate || '-'; }
            } else {
                statusBadge = '<span class="badge bg-secondary">RETURNED</span>';
                dueCell = group.guard || '-'; 
            }

            const canSelect = (currentUser.email === ADMIN_ROLES.STATION_4 || currentUser.email === ADMIN_ROLES.STATION_1);
            const checkboxContent = canSelect ? `<input type="checkbox" class="export-check form-check-input" value="${group.id}">` : `-`;

            const summaryRow = `
                <tr class="align-middle">
                    <td class="text-center">${checkboxContent}</td>
                    <td class="fw-bold text-primary">
                        <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${type}-${safeBatchId}" aria-expanded="false">
                            <i class="fa fa-chevron-right me-2 small"></i>${group.id}
                        </button>
                    </td>
                    <td class="fw-bold">${group.borrower}</td>
                    <td>${group.project}</td>
                    <td><small>${group.date ? new Date(group.date).toLocaleString() : '-'}</small></td>
                    <td><span class="badge bg-light text-dark border">${itemCount} Items</span></td>
                    <td>${dueCell}</td>
                    <td>${statusBadge}</td>
                </tr>`;

            const itemRows = group.items.map(item => `
                <tr>
                    <td class="text-primary fw-bold ps-4" style="width:20%; cursor:pointer;" onclick="window.selectRow('${group.id}')"><i class="fa fa-arrow-turn-up me-1 small"></i><small>${item.serial}</small></td>
                    <td style="width:20%"><small>${item.description}</small></td>
                    <td style="width:10%"><small>${item.asset_no || '-'}</small></td>
                    <td style="width:10%"><small class="text-muted">${item.property_no || '-'}</small></td>
                    <td style="width:15%"><small>${item.destination}</small></td>
                    ${type === 'active' ? `<td style="width:15%"><small>${item.due_date||'-'}</small></td>` : ''}
                </tr>`).join('');

            tbody.innerHTML += summaryRow + `<tr><td colspan="8" class="p-0 border-0"><div class="collapse bg-white" id="collapse-${type}-${safeBatchId}"><div class="p-3 bg-light bg-opacity-10 border-bottom"><table class="table table-sm mb-0 table-borderless table-striped"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th>Description</th><th>Asset</th><th>Property No</th><th>Destination</th>${type==='active'?'<th>Due</th>':''}</tr></thead><tbody>${itemRows}</tbody></table></div></div></td></tr>`;
        });
    }

    renderPaginationControls(type, totalItems, totalPages);
    
    openAccordions.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('show');
            const toggler = document.querySelector(`button[data-bs-target="#${id}"]`);
            if (toggler) { toggler.classList.remove('collapsed'); toggler.setAttribute('aria-expanded', 'true'); }
        }
    });

    if(type === 'active') {
        let overdueCount = groupArray.filter(g => g.dueDate && g.dueDate < new Date().toISOString().split('T')[0]).length;
        const alertBox = document.getElementById('overdueAlert');
        if (alertBox) {
            if (overdueCount > 0) { alertBox.innerText = `${overdueCount} BATCH(ES) OVERDUE`; alertBox.className = "alert alert-danger text-center fw-bold shadow-sm"; } 
            else { alertBox.innerText = "ALL ON SCHEDULE"; alertBox.className = "alert alert-success text-center fw-bold shadow-sm"; }
        }
    }
    updateUnifiedSelectionCount();
}

function renderPaginationControls(type, totalItems, totalPages) {
    const containerId = type + 'Pagination';
    let container = document.getElementById(containerId);
    
    // SAFE CLOSEST CHECK: Ensure tbody and tableDiv exist before using closest
    if (!container) {
        const tbodyId = type === 'active' ? 'activeTableBody' : 'historyTableBody';
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return; 
        
        const tableDiv = tbody.closest('.table-responsive');
        if (!tableDiv) return;
        
        container = document.createElement('div'); 
        container.id = containerId; 
        container.className = "d-flex justify-content-between align-items-center mt-3 pt-2 border-top";
        tableDiv.after(container);
    }
    
    const state = paginationState[type];
    container.innerHTML = `
        <div class="d-flex align-items-center gap-2"><span class="small text-muted">Show</span>
            <select class="form-select form-select-sm" style="width:70px" onchange="changeLimit('${type}', this.value)">
                <option value="5" ${state.limit==5?'selected':''}>5</option><option value="10" ${state.limit==10?'selected':''}>10</option>
                <option value="50" ${state.limit==50?'selected':''}>50</option>
            </select>
            <span class="small text-muted">Total: ${totalItems}</span>
        </div>
        <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary" onclick="changePage('${type}', -1)" ${state.page===1?'disabled':''}>Prev</button>
            <button class="btn btn-sm btn-outline-secondary disabled">Page ${state.page}</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="changePage('${type}', 1)" ${state.page>=totalPages?'disabled':''}>Next</button>
        </div>`;
}

window.changeLimit = (type, limit) => { paginationState[type].limit = parseInt(limit); paginationState[type].page = 1; renderTable(type); };
window.changePage = (type, dir) => { paginationState[type].page += dir; renderTable(type); };

window.updateBatchDueDate = async (batchId, newDate) => {
    if (!batchId || !newDate) return;
    if (!await showConfirm("Update Batch", `Update due date for ${batchId}?`)) return window.refreshTableData();
    try {
        const { error } = await supabase.from('gate_passes').update({ due_date: newDate }).eq('unique_id', batchId);
        if (error) throw error;
        window.refreshTableData();
    } catch (e) { alert("Update failed: " + e.message); }
};

// === SEARCH LISTENER INITIALIZATION ===
function initSearchListeners() {
    const activeSearch = document.getElementById('tableSearch');
    if (activeSearch) {
        const newActiveSearch = activeSearch.cloneNode(true);
        activeSearch.parentNode.replaceChild(newActiveSearch, activeSearch);
        newActiveSearch.addEventListener('input', (e) => {
            paginationState.active.filter = e.target.value.toLowerCase(); paginationState.active.page = 1; renderTable('active');
        });
    }

    const historySearch = document.getElementById('historySearchInput');
    if (historySearch) {
        const newHistorySearch = historySearch.cloneNode(true);
        historySearch.parentNode.replaceChild(newHistorySearch, historySearch);
        newHistorySearch.addEventListener('input', (e) => {
            paginationState.history.filter = e.target.value.toLowerCase(); paginationState.history.page = 1; renderTable('history');
        });
    }
}

document.getElementById('returnBtn')?.addEventListener('click', async () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    
    const batchId = document.getElementById('returnBatchID').value.trim();
    const g = document.getElementById('guardIn').value.trim();
    
    if (!batchId || !g) return alert("Please fill in both the Gate Pass ID and Guard Name.");

    // Verify if the batch exists and is currently 'OUT'
    const { data, error } = await supabase
        .from('gate_passes')
        .select('unique_id')
        .eq('unique_id', batchId)
        .eq('status', 'OUT');

    if (error || !data || data.length === 0) {
        return alert("Batch ID not found or items are not currently marked as 'OUT'.");
    }

    if (!await showConfirm("Batch Return", `Return all ${data.length} items for Batch ${batchId}?`)) return;

    try {
        const { error: updateError } = await supabase
            .from('gate_passes')
            .update({ 
                status: 'RETURNED', 
                guard_in: g, 
                time_return: new Date().toISOString() 
            })
            .eq('unique_id', batchId)
            .eq('status', 'OUT');

        if (updateError) throw updateError;

        alert(`Batch ${batchId} returned successfully!`);
        document.getElementById('returnBatchID').value = "";
        document.getElementById('guardIn').value = "";
        if (window.refreshTableData) window.refreshTableData();
        
    } catch (e) {
        alert("Return failed: " + e.message);
    }
});
window.selectRow = (batchId) => document.getElementById('returnBatchID').value = batchId;

// ==========================================
// F. UTILS & UNIFIED EXPORT LOGIC
// ==========================================

// Trigger an immediate export modal for a specific batch in workflow
window.triggerExportModal = (batchId, status) => {
    let sourceData = [];
    if (status === 'PENDING_PROPERTY') sourceData = station1Data;
    else if (status === 'PENDING_INSPECTION') sourceData = station2Data;
    else if (status === 'PENDING_OIC') sourceData = station3Data;
    else if (status === 'RELEASING') sourceData = releasingData;

    const items = sourceData.filter(i => i.unique_id === batchId);
    if (items.length === 0) return alert("Items not found.");

    window.tempExportItems = items;
    currentExportContext = status.toLowerCase(); 

    document.getElementById('exportModalTitle').innerText = `Exporting Batch: ${batchId}`;
    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) bootstrap.Modal.getOrCreateInstance(exportModalEl).show();
};

function getActiveRecordsTabContext() {
    const activeBtn = document.querySelector('#recordsTabs .nav-link.active');
    return activeBtn ? activeBtn.getAttribute('data-context') : 'active';
}

function updateUnifiedSelectionCount() {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let tableId = 'activeTableBody';

    if (activeViewId === 'view-approvals') {
        tableId = 'releasingTableBody';
    } else {
        const context = getActiveRecordsTabContext();
        tableId = context === 'active' ? 'activeTableBody' : 'historyTableBody';
    }

    const count = document.querySelectorAll(`#${tableId} .export-check:checked`).length;
    const countBadge = document.getElementById('unifiedSelectionCount');
    if (countBadge) countBadge.innerText = `${count} Selected`;
}

// Ensure the target exists and has classList before checking to prevent crashes
document.addEventListener('change', (e) => { 
    if(e.target && e.target.classList && e.target.classList.contains('export-check')) {
        updateUnifiedSelectionCount(); 
    }
});

// Watch tab changes to update selection count badge context (Records and Approvals)
document.querySelectorAll('#recordsTabs .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', () => { updateUnifiedSelectionCount(); });
});
document.querySelectorAll('#approvalTabs .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', () => { updateUnifiedSelectionCount(); });
});

document.getElementById('btnSelectAllUnified')?.addEventListener('click', () => {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let tableId = '';
    if (activeViewId === 'view-approvals') {
        tableId = 'releasingTableBody';
    } else {
        const context = getActiveRecordsTabContext();
        tableId = context === 'active' ? 'activeTableBody' : 'historyTableBody';
    }
    document.querySelectorAll(`#${tableId} .export-check`).forEach(c => c.checked = true);
    updateUnifiedSelectionCount();
});

document.getElementById('btnDeselectAllUnified')?.addEventListener('click', () => {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let tableId = '';
    if (activeViewId === 'view-approvals') {
        tableId = 'releasingTableBody';
    } else {
        const context = getActiveRecordsTabContext();
        tableId = context === 'active' ? 'activeTableBody' : 'historyTableBody';
    }
    document.querySelectorAll(`#${tableId} .export-check`).forEach(c => c.checked = false);
    updateUnifiedSelectionCount();
});

function getSelectedItems() {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let containerId = '';
    let sourceData = [];

    // Context switching: Pull data based on the active UI view (Approvals/Releasing vs Records)
    if (activeViewId === 'view-approvals') {
        currentExportContext = 'releasing';
        containerId = 'releasingTableBody';
        sourceData = releasingData;
    } else {
        currentExportContext = getActiveRecordsTabContext(); // 'active' or 'history'
        containerId = currentExportContext === 'active' ? 'activeTableBody' : 'historyTableBody';
        sourceData = currentExportContext === 'active' ? activeData : historyData;
    }

    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const checkedBoxes = container.querySelectorAll('.export-check:checked');
    if (!checkedBoxes.length) { alert("Select at least one batch from the active table."); return []; }
    
    const selectedBatchIds = Array.from(checkedBoxes).map(cb => cb.value);
    const selectedItems = sourceData.filter(item => selectedBatchIds.includes(item.unique_id));
    
    return selectedItems;
}

document.getElementById('openUnifiedExportModalBtn')?.addEventListener('click', () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_1 && currentUser.email !== ADMIN_ROLES.STATION_4) {
        return alert("Unauthorized: Exporting data is restricted to Station 1 and Station 4 Admins.");
    }
    window.tempExportItems = null; // Clear single-batch state if using bulk export
    const items = getSelectedItems();
    if(items.length === 0) return; 
    
    document.getElementById('exportModalTitle').innerText = `Exporting ${items.length} items from selected batches.`;
    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) bootstrap.Modal.getOrCreateInstance(exportModalEl).show();
});

// EXCEL EXPORT
document.getElementById('btnExportExcel')?.addEventListener('click', async () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_1 && currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    
    // Check if we are exporting a single row batch or checkbox selections
    const items = window.tempExportItems ? window.tempExportItems : getSelectedItems();
    if (!items.length) return;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) {
        return alert("Error: You cannot export multiple borrowers to the same file. Please select batches for a single borrower only.");
    }
    const borrowerName = items[0].borrower || "Unknown";
    const exportModalEl = document.getElementById('exportModal');
    const modalInstance = bootstrap.Modal.getInstance(exportModalEl);
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Excel", `Generate Excel file for ${borrowerName}?`)) return;

    const exportData = items.map(item => {
        const base = {
            "Gate Pass ID": item.unique_id,
            "Borrower": item.borrower,
            "Description": item.description,
            "Serial No.": item.serial,
            "Property No.": item.property_no || '',
            "Asset Tag": item.asset_no || '',
            "Destination": item.destination,
            "Project": item.project || '',
            "Time Out": item.time_out ? new Date(item.time_out).toLocaleString() : ''
        };

        // If items are active OR releasing OR in station approvals, they don't have return info yet. 
        if (['active', 'releasing', 'pending_property', 'pending_inspection', 'pending_oic'].includes(currentExportContext)) {
            return { ...base, "Guard Out": item.guard_out || '', "Due Date": item.due_date || '', "Status": item.status };
        } else {
            return { ...base, "Time Returned": item.time_return ? new Date(item.time_return).toLocaleString() : '', "Guard In": item.guard_in, "Status": item.status };
        }
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logs");
    XLSX.writeFile(wb, `PSA_Logs_${currentExportContext}_${new Date().toISOString().split('T')[0]}.xlsx`);
});

// TRANSMITTAL FORM EXPORT
document.getElementById('btnExportTransmittal')?.addEventListener('click', async () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_1 && currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    
    const items = window.tempExportItems ? window.tempExportItems : getSelectedItems();
    if (items.length === 0) return;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) return alert("Error: Multiple borrowers selected. Please select items for a single borrower.");
    
    const borrowerName = items[0].borrower || "Unknown";
    const projectName = items[0].project || "PSA PROJECT"; 
    
    const exportModalEl = document.getElementById('exportModal');
    const modalInstance = bootstrap.Modal.getInstance(exportModalEl);
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Transmittal", `Generate Transmittal Form for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const stampFooter = () => {
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const footerY = pageHeight - 20;
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(0,0,0);
        
    };

    let currentY = 20;
    doc.setTextColor(0, 0, 0); 
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); 
    doc.text("Republic of the Philippines", 105, currentY, { align: "center" });
    currentY += 5;
    doc.setFont("helvetica", "bold"); doc.text("Philippine Statistics Authority", 105, currentY, { align: "center" });
    currentY += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(projectName.toUpperCase(), 105, currentY, { align: "center" });
    currentY += 15;
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.text("TRANSMITTAL/RECEIPT FORM", 105, currentY, { align: "center" });
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("(Accomplish in duplicate copies)", 105, currentY + 5, { align: "center" });
    currentY += 15;

    const summaryCounts = {};
    items.forEach(item => {
        const desc = (item.description || "Unknown").trim();
        let baseName = desc;
        if(desc.toLowerCase().includes('tablet')) baseName = "Samsung Tablet";
        else if(desc.toLowerCase().includes('laptop')) baseName = "Laptop";
        summaryCounts[baseName] = (summaryCounts[baseName] || 0) + 1;
    });

    const summaryBody = [];
    Object.entries(summaryCounts).forEach(([name, count]) => {
        summaryBody.push([name, String(count)]);
        if (name.includes("Tablet")) {
            summaryBody.push(["Adapter", String(count)]);
            summaryBody.push(["Type C Cable", String(count)]);
            summaryBody.push(["Box", String(count)]);
        } else if (name.includes("Laptop")) {
            summaryBody.push(["Adapter/Charger", String(count)]);
            summaryBody.push(["Laptop Bag", String(count)]);
            summaryBody.push(["Mouse", String(count)]);
        }
    });

    doc.autoTable({
        startY: currentY, head: [['TOTAL', '']], body: summaryBody, theme: 'plain',
        styles: { fontSize: 9, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, valign: 'middle', cellPadding: 1 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineWidth: 0.3, fontStyle: 'bold', halign: 'left' },
        columnStyles: { 0: { cellWidth: 160 }, 1: { cellWidth: 20, halign: 'center' } },
        margin: { left: 15 } 
    });
    currentY = doc.lastAutoTable.finalY + 10;

    const getAccessories = (desc) => {
        const d = (desc || "").toLowerCase();
        if (d.includes('tablet')) return "With type c cable, box\nand adapter";
        if (d.includes('laptop')) return "With charger, bag\nand mouse";
        return "-";
    };

    const tableBody = items.map((item, index) => [
        index + 1, `${item.description}\n\n${item.serial}`, item.asset_no || 'N/A', "1", getAccessories(item.description)
    ]);

    doc.autoTable({
        startY: currentY,
        head: [['No.', 'ITEM NAME\n\nSERIAL No.', 'ASSET TAG No.', 'UNIT', 'ACCESSORIES']],
        body: tableBody, theme: 'plain', 
        styles: { fontSize: 9, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, valign: 'middle', cellPadding: 3 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineWidth: 0.3, fontStyle: 'bold', halign: 'center', valign: 'middle' },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 70 }, 2: { cellWidth: 30, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' }, 4: { cellWidth: 'auto' } },
        margin: { left: 15, right: 15 } 
    });

    let finalY = doc.lastAutoTable.finalY + 20;
    if (finalY + 80 > doc.internal.pageSize.height) { doc.addPage(); finalY = 30; }

    const leftX = 20; const rightX = 120; const lineLen = 70;
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text("Transmitted by:", leftX, finalY); doc.text("Received by:", rightX, finalY);
    finalY += 25; 
    doc.setFont("helvetica", "bold");
    doc.text(currentUserName.toUpperCase(), leftX + (lineLen/2), finalY - 2, { align: 'center' });
    doc.setLineWidth(0.3); doc.line(leftX, finalY, leftX + lineLen, finalY);
    doc.text(borrowerName.toUpperCase(), rightX + (lineLen/2), finalY - 2, { align: 'center' });
    doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("SIGNATURE OVER PRINTED NAME", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("SIGNATURE OVER PRINTED NAME", rightX + (lineLen/2), finalY + 4, { align: 'center' });
    finalY += 15;
    doc.line(leftX, finalY, leftX + lineLen, finalY); doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.text("POSITION/DESIGNATION", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("POSITION/DESIGNATION", rightX + (lineLen/2), finalY + 4, { align: 'center' });
    finalY += 15;
    doc.line(leftX, finalY, leftX + lineLen, finalY); doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.text("DATE SIGNED", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("DATE SIGNED", rightX + (lineLen/2), finalY + 4, { align: 'center' });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) { doc.setPage(i); stampFooter(); }
    doc.save(`Transmittal_${borrowerName}_${new Date().toISOString().split('T')[0]}.pdf`);
});

// GATE PASS EXPORT
document.getElementById('btnExportGatePass')?.addEventListener('click', async () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_1 && currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    
    const items = window.tempExportItems ? window.tempExportItems : getSelectedItems();
    if (items.length === 0) return;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) return alert("Error: Multiple borrowers. Select items for a single borrower only.");

    const borrowerName = items[0].borrower || "Unknown";
    const exportModalEl = document.getElementById('exportModal');
    const modalInstance = bootstrap.Modal.getInstance(exportModalEl);
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Gate Pass", `Generate Gate Pass PDF for ${borrowerName}?`)) return;

    const groupByBorrower = (arr) => arr.reduce((acc, obj) => { const key = obj.borrower; if (!acc[key]) acc[key] = []; acc[key].push(obj); return acc; }, {});
    const groupedItems = groupByBorrower(items);
    const { jsPDF } = window.jspdf;

    Object.keys(groupedItems).forEach((borrowerName) => {
        const doc = new jsPDF();
        const borrowerItems = groupedItems[borrowerName];
        const firstItem = borrowerItems[0];
        const gatePassNo = firstItem.unique_id.replace("PSA-", ""); 

        const stampFooter = () => {
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
            const footerY = pageHeight - 25; 
            doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(0,0,0);
            doc.text("3rd Floor STWLPC Building, 335-338 Sen. Gil Puyat Avenue (Buendia)", pageWidth / 2, footerY, { align: "center" });
            doc.text("Barangay 49 Zone 7, Pasay City Philippines 1300", pageWidth / 2, footerY + 4, { align: "center" });
            doc.text("Telephone (632) 833-8284 Telefax (632) 834-0051", pageWidth / 2, footerY + 8, { align: "center" });
            doc.text("Email Address: ncr5@psa.gov.ph, Website: www.psa.gov.ph", pageWidth / 2, footerY + 12, { align: "center" });
        };

        doc.setTextColor(0, 0, 0); 
        doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text("REPUBLIC OF THE PHILIPPINES", 105, 15, { align: "center" });
        doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("PHILIPPINE STATISTICS AUTHORITY", 105, 20, { align: "center" });
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("NCR - Provincial Statistical Office V", 105, 25, { align: "center" });
        doc.text("Las Piñas Muntinlupa Parañaque Pasay", 105, 30, { align: "center" });

        const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
        doc.setFont("helvetica", "normal"); doc.text(`Date: ${dateStr}`, 15, 45);
        doc.text(`Gate Pass No.: ${gatePassNo}`, 195, 45, { align: 'right' });
        doc.text("Annex A", 195, 50, { align: 'right' }); 

        doc.setFont("helvetica", "bold"); doc.text("TO THE GUARD ON DUTY:", 15, 60);
        doc.setFont("helvetica", "normal");
        let currentY = 70; let currentX = 15; const lineHeight = 7; const pageRightMargin = 195;
        
        const drawUnderlinedText = (text, x, y) => {
            doc.text(text, x, y);
            const width = doc.getTextWidth(text);
            doc.setLineWidth(0.1); doc.line(x, y + 1, x + width, y + 1);
            return width; 
        };

        doc.setFont("helvetica", "normal"); doc.text("Please allow ", currentX, currentY); currentX += doc.getTextWidth("Please allow ");
        doc.setFont("helvetica", "bold");
        const borrowerText = firstItem.borrower.toUpperCase();
        const borrowerWidth = drawUnderlinedText(borrowerText, currentX, currentY);
        currentX += borrowerWidth;

        doc.setFont("helvetica", "normal"); const purposePrefix = " for the purpose of ";
        if (currentX + doc.getTextWidth(purposePrefix) > pageRightMargin) { currentX = 15; currentY += lineHeight; }
        doc.text(purposePrefix, currentX, currentY); currentX += doc.getTextWidth(purposePrefix);

        doc.setFont("helvetica", "bold"); const projectText = firstItem.project || "________________";
        if (currentX + doc.getTextWidth(projectText) > pageRightMargin) { currentX = 15; currentY += lineHeight; }
        const projectWidth = drawUnderlinedText(projectText, currentX, currentY); currentX += projectWidth;

        doc.setFont("helvetica", "normal"); const locationPrefix = " to bring out laptop equipment listed below from PSA Location to ";
        const locWords = locationPrefix.split(/(\s+)/);
        locWords.forEach(word => {
            if(!word) return;
            const wWidth = doc.getTextWidth(word);
            if (currentX + wWidth > pageRightMargin) { currentX = 15; currentY += lineHeight; }
            doc.text(word, currentX, currentY); currentX += wWidth;
        });

        doc.setFont("helvetica", "bold"); const destText = firstItem.destination || "________________";
        if (currentX + doc.getTextWidth(destText) > pageRightMargin) { currentX = 15; currentY += lineHeight; }
        const destWidth = drawUnderlinedText(destText, currentX, currentY); currentX += destWidth;

        doc.setFont("helvetica", "normal"); doc.text(".", currentX, currentY);
        currentY += 12;

        const formatTime = (t) => t ? new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}) : '';
        const tableBody = borrowerItems.map(item => [item.description, item.serial, item.property_no || '', item.asset_no || '', item.destination, formatTime(item.time_out), item.time_return ? formatTime(item.time_return) : '']);

        doc.autoTable({
            startY: currentY,
            head: [['Description of\nLaptop/Equipment', 'Serial\nNumber', 'Property\nNumber', 'Asset\nTag No.', 'Destination', 'Time\nOut', 'Time\nReturned']],
            body: tableBody, theme: 'grid', 
            styles: { textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontSize: 9, valign: 'middle', halign: 'center' },
            headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontStyle: 'bold', halign: 'center' },
            columnStyles: { 0: { halign: 'left', cellWidth: 50 } },
            margin: { bottom: 30 }
        });

        let finalY = doc.lastAutoTable.finalY + 10;
        if (finalY + 80 > doc.internal.pageSize.height - 30) { doc.addPage(); finalY = 20; }

        doc.setFontSize(10); doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
        doc.text("Remarks:", 15, finalY); finalY += 6;
        doc.line(15, finalY, 195, finalY); finalY += 8; doc.line(15, finalY, 195, finalY); finalY += 10;

        doc.setFont("helvetica", "bold"); doc.text("Checked / Inspected by:", 15, finalY); finalY += 15;

        const drawCenteredSig = (name, title, x, y) => {
            doc.setFont("helvetica", "bold");
            const nameWidth = doc.getTextWidth(name); const lineWidth = Math.max(nameWidth + 10, 60); 
            doc.text(name, x, y, { align: "center" });
            const lineStart = x - (lineWidth / 2); const lineEnd = x + (lineWidth / 2);
            doc.setLineWidth(0.3); doc.line(lineStart, y + 1.5, lineEnd, y + 1.5); 
            doc.setFont("helvetica", "normal"); doc.setFontSize(9);
            const splitTitle = doc.splitTextToSize(title, lineWidth + 30); 
            doc.text(splitTitle, x, y + 6, { align: "center" });
            doc.setFontSize(10);
        };

        drawCenteredSig("JENOR B. BLAS", "Property and Supply Officer", 60, finalY);
        drawCenteredSig("MARY ANNE G. BASILIO", "Inspection Officer", 150, finalY);
        finalY += 25; 
        doc.setFont("helvetica", "bold"); doc.text("Approved by:", 105, finalY - 12, { align: "center" }); 
        drawCenteredSig("MARICEL M. CARAGAN", "Supervising Statistical Specialist\nOfficer-in-Charge, PSA NCR PSO V", 105, finalY);

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) { doc.setPage(i); stampFooter(); }
        doc.save(`GatePass_${borrowerName}_${firstItem.unique_id}.pdf`);
    });
});

// ACK RECEIPT EXPORT
document.getElementById('btnExportAckReceipt')?.addEventListener('click', async () => {
    if (currentUser.email !== ADMIN_ROLES.STATION_1 && currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    
    const items = window.tempExportItems ? window.tempExportItems : getSelectedItems();
    if (items.length === 0) return;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) { return alert("Error: Multiple borrowers selected."); }
    const borrowerName = items[0].borrower || "Unknown";
    const exportModalEl = document.getElementById('exportModal');
    const modalInstance = bootstrap.Modal.getInstance(exportModalEl);
    if (modalInstance) modalInstance.hide();
    if (!await showConfirm("Export Receipt", `Generate Acknowledgement Receipt for ${borrowerName}?`)) return;

    const projectName = items[0].project || "N/A";
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    const addFooter = (docInstance) => {
        const pageCount = docInstance.internal.getNumberOfPages();
        const pageWidth = docInstance.internal.pageSize.width;
        const pageHeight = docInstance.internal.pageSize.height;
        const footerY = pageHeight - 20;
        docInstance.setLineWidth(0.5); docInstance.line(10, footerY - 5, pageWidth - 10, footerY - 5);
        docInstance.setFontSize(8); docInstance.setFont("helvetica", "normal"); docInstance.setTextColor(0, 0, 0);
        docInstance.text("3rd Floor STWLPC Building, 335-338 Sen. Gil Puyat Avenue (Buendia)", pageWidth / 2, footerY, { align: "center" });
        docInstance.text("Barangay 49 Zone 7, Pasay City Philippines 1300", pageWidth / 2, footerY + 4, { align: "center" });
        docInstance.text("Telephone (632) 833-8284 • Telefax (632) 834-0051", pageWidth / 2, footerY + 8, { align: "center" });
        docInstance.text("Email Address: ncr5@psa.gov.ph, Website: www.psa.gov.ph", pageWidth / 2, footerY + 12, { align: "center" });
    };

    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const refNo = items[0].unique_id || `PSA-${Math.floor(1000 + Math.random() * 9000)}`; 
    doc.text(`Ref No.: ${refNo}`, 15, 15);
    doc.setFontSize(11); doc.text("REPUBLIC OF THE PHILIPPINES", 105, 15, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("PHILIPPINE STATISTICS AUTHORITY", 105, 20, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Acknowledgment Form", 105, 30, { align: "center" });

    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const text1 = "All hired field-based personnel for the specified project listed below acknowledges the receipt of the following: a) tablet, b) accessories compatible case and adapter, and c) powerbank.";
    const text2 = "All personnel who were given these devices will be held liable for any acts of negligence and malicious intent resulting to the loss or damage of these tablets. Should there be a lost/damaged tablet, the responsible personnel should immediately inform the incident to their immediate supervisor. Upon the evaluation of the Philippine Statistics Authority (PSA) Provincial Statistical Office (PSO) Chief Statistical Specialist (CSS), an anticipated cost required to repair the damage in the tablet must be shouldered by the liable personnel. In the event that the tablet is lost, a salary deduction equivalent to the market value of the comparable device must be charged against the responsible personnel. Due to this, it is crucial to exercise caution and care to the equipment/device entrusted by the PSA to every field-based personnel for the successful and secure operationalization.";
    const text3 = "Affixing your name and signature in the next page signifies that you hereby acknowledge the receipt of the above-listed devices/items under your name and fully understand the responsibilities attached to these.";
    const splitText1 = doc.splitTextToSize(text1, 180); doc.text(splitText1, 15, 40);
    const splitText2 = doc.splitTextToSize(text2, 180); doc.text(splitText2, 15, 55);
    const splitText3 = doc.splitTextToSize(text3, 180);
    let currentY = 55 + (splitText2.length * 5) + 5; doc.text(splitText3, 15, currentY);
    currentY += (splitText3.length * 5) + 10;
    doc.setFont("helvetica", "bold"); doc.text(`Project: ${projectName}`, 15, currentY); doc.text("Instructor: ___________________________", 15, currentY + 7);
    currentY += 15;

    const tableData = items.map((item, index) => {
        let accessories = "-";
        const descLower = (item.description || "").toLowerCase();
        if (descLower.includes('tablet') || descLower.includes('samsung') || descLower.includes('ipad') || descLower.includes('tab')) { accessories = "With Powerbank and/or Accessories"; }
        else if (descLower.includes('laptop')) { accessories = "With Charger and Bag"; }
        return [index + 1, "", (item.description && item.description.toLowerCase().includes('samsung')) ? "Samsung" : (item.description || ""), item.serial, item.asset_no || "", accessories, "", ""];
    });

    doc.autoTable({
        startY: currentY,
        head: [["No.", "Name of Hired\nBased Personnel", "Tablet Brand", "Serial Number", "Asset Tag\nNumber", "With Powerbank\nand/or Accessories", "Signature", "Date of\nAcknowledgement"]],
        body: tableData, theme: 'grid',
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 8 },
        styles: { textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontSize: 8, valign: 'middle' },
        columnStyles: { 0: { width: 10, halign: 'center' }, 1: { width: 35 }, 2: { width: 20 }, 3: { width: 25 }, 4: { width: 20, halign: 'center' }, 5: { width: 30, fontSize: 7 }, 6: { width: 25 }, 7: { width: 20 } },
        didDrawPage: function (data) { addFooter(doc); }
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) { doc.setPage(i); doc.setFontSize(8); doc.text(`Page ${i} of ${totalPages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 4); }
    doc.save(`AcknowledgementReceipt_${projectName}_${new Date().toISOString().split('T')[0]}.pdf`);
});

const processImportBtn = document.getElementById('processImportBtn');
if (processImportBtn) {
    processImportBtn.addEventListener('click', () => {
        const f = document.getElementById('inventoryFile').files[0];
        if(!f) return alert("Select file");
        const r = new FileReader();
        r.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            let rawData = json.map(row => ({
                serial: String(row['serial_no'] || row['Serial'] || "").trim(),
                description: row['description'] || row['Description'],
                asset_no: row['asset_no'] || row['Asset'],
                property_no: row['property_no'] || row['Property']
            })).filter(x => x.serial);
            const uniqueMap = new Map(); rawData.forEach(item => { uniqueMap.set(item.serial, item); });
            bulkImportData = Array.from(uniqueMap.values());
            const tbody = document.getElementById('importBody'); tbody.innerHTML = "";
            bulkImportData.slice(0, 5).forEach(d => { tbody.innerHTML += `<tr><td>${d.serial}</td><td>${d.property_no}</td><td>${d.description}</td><td>${d.asset_no}</td></tr>`; });
            document.getElementById('importPreview').style.display='block'; document.getElementById('saveBulkBtn').style.display='block';
        };
        r.readAsArrayBuffer(f);
    });
}

// --- UPDATED FUNCTION: CHUNKED BULK UPLOAD (FIXED 1000 LIMIT) ---
document.getElementById('saveBulkBtn')?.addEventListener('click', async () => {
    if(!bulkImportData.length) return;
    if(!await showConfirm("Import", `Save ${bulkImportData.length} items?`)) return;
    
    const CHUNK_SIZE = 1000;
    
    // Show loading state
    const btn = document.getElementById('saveBulkBtn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Importing...";

    try {
        for (let i = 0; i < bulkImportData.length; i += CHUNK_SIZE) {
            const chunk = bulkImportData.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from('inventory').upsert(chunk, { onConflict: 'serial' });
            
            if(error) {
                throw new Error(`Batch ${i/CHUNK_SIZE + 1} failed: ${error.message}`);
            }
        }
        
        alert("Imported successfully!"); 
        bulkImportData = []; 
        document.getElementById('importPreview').style.display='none';
        if(window.loadInventoryStats) window.loadInventoryStats(); // Refresh stats immediately
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
});

window.addEventListener('DOMContentLoaded', () => { 
    checkUserSession(); 
    // Clear temporary export memory if export modal is closed
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.addEventListener('hidden.bs.modal', () => {
            window.tempExportItems = null;
        });
    }
});