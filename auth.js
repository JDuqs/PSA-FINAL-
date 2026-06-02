// Authentication & User Management
import { supabase, supabaseLib, SUPABASE_URL, SUPABASE_KEY, isAnyAdmin, isSuperAdmin } from './config.js';
import { state } from './state.js';
import { showConfirm } from './utils.js';

// --- LOGIN LOGIC ---
export async function handleGuardLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('guardEmail').value.toLowerCase().trim();
    const password = document.getElementById('guardPassword').value;

    if (!email || !password) return alert("Please enter Guard ID/Email and password");

    const btn = document.getElementById('guardLoginBtn');
    if(btn) { btn.disabled = true; btn.innerText = "Verifying Guard Access..."; }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // SINGLE DEVICE ENFORCEMENT (reuse logic)
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
                role: 'guard',  // Default to guard role
                approved: true
            }, { onConflict: 'email' });
        }

        localStorage.setItem('session_token', sessionToken);
        localStorage.setItem('guard_name', data.user.user_metadata?.full_name || email.split('@')[0]);

        // Fetch latest user data
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (userError || !userData || userData.approved !== true) {
            await supabase.auth.signOut();
            throw new Error("Guard access denied. Contact Admin.");
        }

        // GUARD CHECK: Must have role 'guard' or department 'guard'
        const isGuard = userData.role === 'guard' || String(userData.department || '').toLowerCase() === 'guard';
        if (!isGuard) {
            await supabase.auth.signOut();
            throw new Error("This account does not have Security Guard access. Please use main login.");
        }

        // SUCCESS: Redirect to guard dashboard
        window.location.href = 'guard-dashboard.html';

    } catch (error) {
        const msgEl = document.getElementById('guardErrorMsg');
        let displayMsg = "Guard Login Failed: " + error.message;
        if (error.message.includes("Invalid login credentials")) displayMsg = "Incorrect Guard ID/Email or password.";
        
        if (msgEl) msgEl.innerText = displayMsg;
        else alert(displayMsg);
        
        await supabase.auth.signOut();
        if(btn) { btn.disabled = false; btn.innerText = "ACCESS SUPPLIES TRACKING"; }
    }
}
export async function handleLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('email').value.toLowerCase().trim();
    const password = document.getElementById('password').value;

    if (!email || !password) return alert("Please enter email and password");

    const btn = document.getElementById('loginBtn');
    if(btn) { btn.disabled = true; btn.innerText = "Verifying..."; }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) throw error;

        const { data: existingUserRecord, error: existingUserError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (existingUserError) throw existingUserError;

        // --- SINGLE DEVICE ENFORCEMENT START ---
        const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        
        const { error: updateError, count } = await supabase
            .from('users')
            .update({ session_token: sessionToken })
            .eq('uid', data.user.id)
            .select('uid', { count: 'exact' });

        if (updateError || count === 0) {
            if (isAnyAdmin(email)) {
                await supabase.from('users').upsert({
                    uid: data.user.id,
                    email: email,
                    session_token: sessionToken,
                    name: existingUserRecord?.name || email.split('@')[0].toUpperCase(),
                    role: 'admin',
                    approved: true,
                    department: existingUserRecord?.department || 'PSA'
                }, { onConflict: 'email' });
            } else if (existingUserRecord) {
                const { error: fallbackUpdateError } = await supabase
                    .from('users')
                    .update({
                        uid: data.user.id,
                        session_token: sessionToken
                    })
                    .eq('email', email);

                if (fallbackUpdateError) throw fallbackUpdateError;
            }
        }

        localStorage.setItem('session_token', sessionToken);
        // --- SINGLE DEVICE ENFORCEMENT END ---

        let targetDashboard = 'dashboard.html'; // Default target
        let userDepartment = data.user.user_metadata?.department; // Start with metadata

        // ALWAYS fetch the latest user data from the database (Ultimate source of truth)
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*') 
            .eq('email', email)
            .maybeSingle();

        // CRITICAL FIX: Validate userData exists before role access
        if (!userData) {
            console.error('No userData found for email:', email);
            await supabase.auth.signOut();
            throw new Error('User profile not found in database.');
        }

        if (!isAnyAdmin(email)) {
            if (userError || userData.approved !== true) {
                await supabase.auth.signOut();
                if (userError) throw new Error("Account setup incomplete. Please contact Admin.");
                if (userData.approved !== true) throw new Error("Access Denied: Pending Admin approval.");
            }
        }

        // OVERRIDE: Let the database column override the Auth metadata.
        // Auth metadata can get stuck if a user makes a mistake during signup.
        if (userData && userData.department) {
            userDepartment = userData.department;
        }

        // Normalize string for safe comparison (removes spaces, ignores capitalization)
        const finalDept = String(userDepartment || '').trim().toLowerCase();

        // REDIRECT LOGIC - BLOCK GUARDS FROM MAIN DASHBOARD
        const isGuard = userData.role === 'guard' || String(userData.department || '').toLowerCase() === 'guard';
        if (isGuard) {
            window.location.href = 'guard-dashboard.html';
        } else if (finalDept === 'philsys') {
            window.location.href = 'philsys_dashboard.html';
        } else {
            window.location.href = targetDashboard; // Goes to 'dashboard.html'
        }

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

// --- SIGNUP LOGIC ---
export async function handleSignup(e) {
    if (e) e.preventDefault();
    
    const name = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.toLowerCase().trim();
    const pass = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;
    const department = document.getElementById('regDepartment').value; // NEW: Get Department

    if (!name || !email) return alert("Please fill all details.");
    if (!department) return alert("Please select a department.");
    if (pass.length < 6) return alert("Password must be at least 6 characters.");
    if (pass !== passConfirm) return alert("Passwords do not match!");

    const btn = document.getElementById('requestBtn') || document.getElementById('guardSignupBtn');
    if(btn) { btn.disabled = true; btn.innerText = "Processing..."; }

    try {
        // FIX: Explicitly check if email already exists in pending requests or approved users
        const { data: existingReq } = await supabase.from('registration_requests').select('email').eq('email', email).maybeSingle();
        const { data: existingUser } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
        
        if (existingReq || existingUser) {
            alert("This email is already registered or has a pending access request.");
            if(btn) { btn.disabled = false; btn.innerText = "SUBMIT ACCESS REQUEST"; }
            return;
        }

        // ADDED: department to user_metadata
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email, password: pass, options: { data: { full_name: name, department: department } }
        });
        if (authError) throw authError;

        // ADDED: department column
        await supabase.from('registration_requests').insert([{ name, email, pass, status: 'PENDING', department: department }]);
        
        const uid = authData.user ? authData.user.id : null;
        // ADDED: department column
        await supabase.from('users').insert([{ email, name, password: pass, approved: false, role: 'user', uid: uid, department: department }]);

        alert("Request submitted! Wait for Admin approval.");
        await supabase.auth.signOut(); 
        window.location.href = 'index.html';

    } catch (error) {
        alert("Error: " + error.message);
        if(btn) { btn.disabled = false; btn.innerText = "SUBMIT ACCESS REQUEST"; }
    }
}

// --- ADMIN: LOAD REQUESTS ---
export async function loadRegistrationRequests() {
    const tbody = document.getElementById('requestTableBody');
    const section = document.getElementById('adminRequestSection');
    
    if (!tbody) return;
    if(section) section.style.display = 'block';

    const fetchRequests = async () => {
        try {
            // FIX: Only fetch pending requests
            const { data, error } = await supabase.from('registration_requests').select('*').eq('status', 'PENDING');
            if (error) throw error;
            
            tbody.innerHTML = "";
            
            if (!data || data.length === 0) {
                tbody.innerHTML = "<tr><td colspan='4' class='text-center text-muted py-3'>No pending requests.</td></tr>";
                updateBadges(0);
                return;
            }

            updateBadges(data.length);

            data.forEach(d => {
                const deptDisplay = d.department ? ` <span class="badge ${d.department.toLowerCase() === 'guard' ? 'bg-warning' : 'bg-secondary'} ms-1">${d.department}</span>` : '';
                tbody.innerHTML += `
                    <tr>
                        <td class="fw-bold">${d.name}${deptDisplay}</td>
                        <td>${d.email}</td>
                        <td class="text-muted"><i>Hidden for security</i></td>
                        <td class="text-center">
                            <button class="btn btn-success btn-sm me-1 fw-bold" onclick="window.approveUser('${d.id}', '${d.email}', '${d.name}', '${d.pass}', '${d.department || 'PSA'}')">Confirm</button>
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

// --- ADMIN: APPROVE/DENY ---
export async function approveUser(reqId, email, name, password, department = 'PSA') {
    const userRole = (department || '').toLowerCase() === 'guard' ? 'guard' : 'user';

    if (!await showConfirm("Approve", `Approve access for ${email}?`)) return;
    try {
        // ADDED: Preserve department during upsert
        await supabase.from('users').upsert({ email: email, name: name, password: password, approved: true, role: userRole, department: department }, { onConflict: 'email' });
        await supabase.from('registration_requests').delete().eq('id', reqId);
        alert("User Approved!");
        window.location.reload(); 
    } catch (e) { alert(e.message); }
}

export async function cancelRequest(id) {
    if (await showConfirm("Reject", "Delete this request completely?")) {
        try {
            await supabase.from('registration_requests').delete().eq('id', id);
            alert("Request rejected.");
            window.location.reload();
        } catch (e) { alert(e.message); }
    }
}

// --- ADMIN BADGE MONITOR ---
export function startAdminBadgeMonitor() {
    const checkBadge = async () => {
        try {
            // FIX: More reliable counting method (fetching IDs instead of using head/exact)
            const { data, error } = await supabase
                .from('registration_requests')
                .select('id')
                .eq('status', 'PENDING');
            
            if (!error && data) {
                console.log("[Badge Monitor] Pending requests found:", data.length);
                updateBadges(data.length);
            } else if (error) {
                console.error("[Badge Monitor] Error fetching requests:", error);
            }
        } catch (e) { console.error("Badge monitor error:", e); }
    };
    
    // Run immediately, then set interval
    checkBadge();
    setInterval(checkBadge, 5000); // Check every 5 seconds
}

export async function loadCurrentStationAdmins() {
    const tbody = document.getElementById('currentStationAdminsBody');
    if (!tbody) return;

    const stationRows = [
        { role: 'Station 1', department: 'Property' },
        { role: 'Station 2 - Inspection (PSA)', department: 'Inspection' },
        { role: 'Station 2 - Inspection (PhilSys)', department: 'Station 2 PhilSys' },
        { role: 'Station 3', department: 'OIC' },
        { role: 'Station 3 Approval', department: 'Station 3 Approval' }
    ];

    try {
        const departments = [...stationRows.map(row => row.department), 'Viewer'];
        const { data, error } = await supabase
            .from('users')
            .select('name, email, department, role, approved')
            .eq('role', 'admin')
            .in('department', departments);

        if (error) throw error;

        const nonViewerAdmins = (data || []).filter(admin => admin.department !== 'Viewer');
        const viewerAdmins = (data || [])
            .filter(admin => admin.department === 'Viewer')
            .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
        const adminsByDepartment = new Map();
        nonViewerAdmins
            .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
            .forEach(admin => {
                const list = adminsByDepartment.get(admin.department) || [];
                list.push(admin);
                adminsByDepartment.set(admin.department, list);
            });
        tbody.innerHTML = '';

        stationRows.forEach(row => {
            const admins = adminsByDepartment.get(row.department) || [];

            if (admins.length === 0) {
                tbody.innerHTML += `
                    <tr>
                        <td class="fw-bold">${row.role}</td>
                        <td>${row.department}</td>
                        <td><span class="text-muted">Unassigned</span></td>
                        <td><span class="text-muted">No current admin</span></td>
                    </tr>
                `;
                return;
            }

            admins.forEach((admin) => {
                tbody.innerHTML += `
                    <tr>
                        <td class="fw-bold">${row.role}</td>
                        <td>${row.department}</td>
                        <td>${admin.name || '<span class="text-muted">Unnamed</span>'}</td>
                        <td>${admin.email || '<span class="text-muted">No current admin</span>'}</td>
                    </tr>
                `;
            });
        });

        if (viewerAdmins.length > 0) {
            viewerAdmins.forEach((admin, index) => {
                tbody.innerHTML += `
                    <tr>
                        <td class="fw-bold">Viewer ${index + 1}</td>
                        <td>Viewer</td>
                        <td>${admin.name || '<span class="text-muted">Unnamed</span>'}</td>
                        <td>${admin.email || '<span class="text-muted">No current admin</span>'}</td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML += `
                <tr>
                    <td class="fw-bold">Viewer</td>
                    <td>Viewer</td>
                    <td><span class="text-muted">Unassigned</span></td>
                    <td><span class="text-muted">No current admin</span></td>
                </tr>
            `;
        }
    } catch (error) {
        tbody.innerHTML = "<tr><td colspan='4' class='text-center text-danger py-3'>Failed to load current station admins.</td></tr>";
    }
}

// --- HELPER: UPDATE ALL BADGES ---
function updateBadges(count) {
    // Look for all possible badge IDs you might be using
    const badges = [
        document.getElementById('adminRequestBadge'),
        document.getElementById('adminPageBadge'),
        document.getElementById('manageUserBadge') // Extra ID catch
    ];
    
    badges.forEach(badge => {
        if (!badge) return;
        
        if (count > 0) {
            badge.textContent = count;
            // Force visibility ignoring Bootstrap's standard hidden behavior
            badge.style.setProperty('display', 'inline-block', 'important');
            badge.classList.remove('d-none', 'hidden');
            // Ensure it has notification styling
            badge.classList.add('badge', 'bg-danger', 'rounded-pill');
        } else {
            badge.style.setProperty('display', 'none', 'important');
            badge.classList.add('d-none');
        }
    });
}

// --- CREATE ADMIN ACCOUNT (Super Admin Only) ---
const STATION_DEPTS = {
  'station1': { dept: 'Property' },
  'station2': { dept: 'Inspection' },
  'station2philsys': { dept: 'Station 2 PhilSys' },
  'station3': { dept: 'OIC' },
  'station3approval': { dept: 'Station 3 Approval' },
  'viewer': { dept: 'Viewer' }
};

const MAX_STATION3_APPROVAL_ADMINS = 1;
const MAX_VIEWER_ADMINS = 3;

async function createAdminAuthProfile(name, lowerEmail, password, dept) {
  const authClient = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    }
  });

  const { data: authData, error: authError } = await authClient.auth.signUp({
    email: lowerEmail,
    password,
    options: { data: { full_name: name, department: dept } }
  });

  if (authError) {
    throw new Error('Auth signup failed: ' + authError.message);
  }

  const uid = authData.user ? authData.user.id : null;

  let { error: insertError } = await supabase.from('users').insert({
    uid,
    email: lowerEmail,
    name,
    password,
    role: 'admin',
    department: dept,
    approved: true
  });

  if (insertError && String(insertError.message || '').includes('users_uid_fkey')) {
    const retryResult = await supabase.from('users').insert({
      uid: null,
      email: lowerEmail,
      name,
      password,
      role: 'admin',
      department: dept,
      approved: true
    });
    insertError = retryResult.error;
  }

  if (insertError) {
    throw new Error(`Profile creation failed after auth signup: ${insertError.message}`);
  }

  return {
    success: true,
    name,
    email: lowerEmail,
    dept,
    message: `${dept} admin created successfully for ${lowerEmail}.`
  };
}

async function createStationAdminFallback(fullName, email, password, stationKey) {
  const station = STATION_DEPTS[stationKey];
  if (!station) {
    throw new Error('Invalid admin role selected');
  }

  const dept = station.dept;
  const lowerEmail = email.toLowerCase().trim();
  const name = String(fullName || '').trim();

  if (dept === 'Viewer') {
    const { data: viewerUsers, error: viewerUsersError } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .eq('department', dept);

    if (viewerUsersError) {
      throw new Error(`Failed to check existing viewer admins: ${viewerUsersError.message}`);
    }

    const viewerEmailSet = new Set();
    (viewerUsers || []).forEach(user => {
      const emailValue = String(user.email || '').toLowerCase().trim();
      if (emailValue) viewerEmailSet.add(emailValue);
    });

    const viewerCount = viewerEmailSet.size;
    const isExistingViewerEmail = viewerEmailSet.has(lowerEmail);

    const { data: existingUser } = await supabase
      .from('users')
      .select('email, role, department')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (existingUser && !(existingUser.role === 'admin' && existingUser.department === dept)) {
      throw new Error('Email already exists in users table');
    }

    if (!isExistingViewerEmail && viewerCount >= MAX_VIEWER_ADMINS) {
      throw new Error(`Viewer admin limit reached. Only ${MAX_VIEWER_ADMINS} viewer accounts are allowed.`);
    }

    if (existingUser?.email) {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name,
          password,
          role: 'admin',
          department: dept,
          approved: true
        })
        .eq('email', lowerEmail);

      if (updateError) {
        throw new Error(`Failed to update existing ${dept} admin: ${updateError.message}`);
      }

      return {
        success: true,
        reusedEmail: true,
        name,
        email: lowerEmail,
        dept,
        message: `Updated the existing ${dept} admin profile for ${lowerEmail}. If you changed the password, update it in Supabase Authentication too.`
      };
    }

    return await createAdminAuthProfile(name, lowerEmail, password, dept);
  }

  if (dept === 'Station 3 Approval') {
    const { data: stationAdmins, error: stationAdminsError } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .eq('department', dept);

    if (stationAdminsError) {
      throw new Error(`Failed to check existing ${dept} admins: ${stationAdminsError.message}`);
    }

    const stationEmailSet = new Set();
    (stationAdmins || []).forEach(user => {
      const emailValue = String(user.email || '').toLowerCase().trim();
      if (emailValue) stationEmailSet.add(emailValue);
    });

    const isExistingStationEmail = stationEmailSet.has(lowerEmail);

    const { data: existingUser } = await supabase
      .from('users')
      .select('email, role, department')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (existingUser && !(existingUser.role === 'admin' && existingUser.department === dept)) {
      throw new Error('Email already exists in users table');
    }

    if (!isExistingStationEmail && stationEmailSet.size >= MAX_STATION3_APPROVAL_ADMINS) {
      throw new Error('Station 3 approval account already exists. Only one additional Station 3 approval account is allowed.');
    }

    if (existingUser?.email) {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name,
          password,
          role: 'admin',
          department: dept,
          approved: true
        })
        .eq('email', lowerEmail);

      if (updateError) {
        throw new Error(`Failed to update existing ${dept} admin: ${updateError.message}`);
      }

      return {
        success: true,
        reusedEmail: true,
        name,
        email: lowerEmail,
        dept,
        message: `Updated the existing ${dept} admin profile for ${lowerEmail}. If you changed the password, update it in Supabase Authentication too.`
      };
    }

    return await createAdminAuthProfile(name, lowerEmail, password, dept);
  }

  const { data: existingStationAdmin } = await supabase
    .from('users')
    .select('email')
    .eq('role', 'admin')
    .eq('department', dept)
    .maybeSingle();

  if (existingStationAdmin && existingStationAdmin.email !== lowerEmail) {
    throw new Error(`A ${dept} admin still exists in the users table (${existingStationAdmin.email}). Delete the old station admin from Table Editor and Authentication first, then try again.`);
  }

  const { data: existingUser } = await supabase
    .from('users')
    .select('email')
    .eq('email', lowerEmail)
    .maybeSingle();

  if (existingUser && existingStationAdmin?.email !== lowerEmail) {
    throw new Error('Email already exists in users table');
  }

  if (existingStationAdmin?.email === lowerEmail) {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        name,
        password,
        role: 'admin',
        department: dept,
        approved: true
      })
      .eq('email', lowerEmail);

    if (updateError) {
      throw new Error(`Failed to update existing ${dept} admin: ${updateError.message}`);
    }

    return {
      success: true,
      reusedEmail: true,
      name,
      email: lowerEmail,
      dept,
      message: `Updated the existing ${dept} admin profile for ${lowerEmail}. If you changed the password, update it in Supabase Authentication too.`
    };
  }

  return await createAdminAuthProfile(name, lowerEmail, password, dept);
}

export async function createStationAdmin(fullName, email, password, stationKey) {
  if (!STATION_DEPTS[stationKey]) {
    throw new Error('Invalid admin role selected');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email || !isSuperAdmin(session.user.email)) {
    throw new Error('Only admin@psa.gov.ph can create admin accounts');
  }

  const name = String(fullName || '').trim();
  if (!name || !email || !password || password.length < 6) {
    throw new Error('Invalid input: Name, email, password (min 6 chars) required');
  }

  return await createStationAdminFallback(name, email, password, stationKey);
}
// --- AUTO-INITIALIZATION ---
// This ensures the badge monitor actually starts running when the page loads
// Export functions to window for HTML onclick usage
window.handleGuardLogin = handleGuardLogin;
window.handleLogin = handleLogin;
window.approveUser = approveUser;
window.cancelRequest = cancelRequest;
window.createStationAdmin = createStationAdmin;

document.addEventListener('DOMContentLoaded', () => {
    // Wait a brief moment to ensure all HTML elements are rendered
    setTimeout(() => {
        const hasBadgeElements = document.getElementById('adminRequestBadge') || 
                                 document.getElementById('adminPageBadge') || 
                                 document.getElementById('manageUserBadge');
                                 
        if (hasBadgeElements) {
            console.log("Badge elements detected. Starting badge monitor...");
            startAdminBadgeMonitor();
        }
    }, 500);
});


