// 1. SUPABASE CONFIGURATION & CONSTANTS
export const SUPABASE_URL = 'https://bnkqrvsfioadhgvhylur.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_YzlzjTy_eTVFhXOOvfsAiQ_5bRGVzMi';
export const supabaseLib = window.supabase;
export const supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY);

// GLOBAL VARIABLES & ROLES
export const ADMIN_ROLES = {
    STATION_1: "admin1@psa.gov.ph", // Property - Can Export, Approve Stn 1
    STATION_2: "admin2@psa.gov.ph", // Inspection - Approve Stn 2 only
    STATION_3: "admin3@psa.gov.ph", // OIC - Approve Stn 3 only
    STATION_4: "admin@psa.gov.ph"   // Release/Main - Can Export, Approve Stn 4, Return, Manage Users
};

export const ADMIN_NAMES = {
    "admin@psa.gov.ph": "Rigor S. Cubinor",
    "admin1@psa.gov.ph": "Jenor B. Blas",
    "admin2@psa.gov.ph": "Mary Anne G. Basilio",
    "admin3@psa.gov.ph": "Maricel M. Caragan"
};

function getEmail(userOrEmail) {
    if (!userOrEmail) return '';
    return typeof userOrEmail === 'string'
        ? userOrEmail.toLowerCase().trim()
        : String(userOrEmail.email || '').toLowerCase().trim();
}

function getRole(userOrEmail) {
    if (!userOrEmail || typeof userOrEmail === 'string') return '';
    return String(userOrEmail.role || '').trim().toLowerCase();
}

export function getDepartment(userOrEmail) {
    if (!userOrEmail || typeof userOrEmail === 'string') return '';
    return String(userOrEmail.department || userOrEmail.user_metadata?.department || '').trim();
}

function hasLegacyAdminEmail(userOrEmail) {
    return Object.values(ADMIN_ROLES).includes(getEmail(userOrEmail));
}

function hasAdminDepartment(userOrEmail) {
    const dept = getDepartment(userOrEmail).toLowerCase();
    return getRole(userOrEmail) === 'admin' && ['property', 'inspection', 'oic', 'station 3 approval', 'psa', 'viewer'].includes(dept);
}

export function isAnyAdmin(userOrEmail) {
    if (!userOrEmail) return false;
    if (typeof userOrEmail !== 'string' && getRole(userOrEmail) === 'admin') return true;
    return hasLegacyAdminEmail(userOrEmail) || hasAdminDepartment(userOrEmail);
}

export function isViewerAdmin(userOrEmail) {
    const dept = getDepartment(userOrEmail).toLowerCase();
    return getRole(userOrEmail) === 'admin' && dept === 'viewer';
}

export function isSuperAdmin(userOrEmail) {
    return getEmail(userOrEmail) === 'admin@psa.gov.ph';
}

export function isStation1Admin(userOrEmail) {
    return (getRole(userOrEmail) === 'admin' && getDepartment(userOrEmail).toLowerCase() === 'property') || getEmail(userOrEmail) === ADMIN_ROLES.STATION_1;
}

export function isStation2Admin(userOrEmail) {
    return (getRole(userOrEmail) === 'admin' && getDepartment(userOrEmail).toLowerCase() === 'inspection') || getEmail(userOrEmail) === ADMIN_ROLES.STATION_2;
}

export function canHandleStation1(userOrEmail) {
    return isStation1Admin(userOrEmail) || isStation2Admin(userOrEmail);
}

export function canHandleStation2(userOrEmail) {
    return isStation1Admin(userOrEmail) || isStation2Admin(userOrEmail);
}

export function isStation3Admin(userOrEmail) {
    const dept = getDepartment(userOrEmail).toLowerCase();
    return (getRole(userOrEmail) === 'admin' && ['oic', 'station 3 approval'].includes(dept)) || getEmail(userOrEmail) === ADMIN_ROLES.STATION_3;
}

export function isStation4Admin(userOrEmail) {
    return (getRole(userOrEmail) === 'admin' && getDepartment(userOrEmail).toLowerCase() === 'psa') || getEmail(userOrEmail) === ADMIN_ROLES.STATION_4;
}

export function canManageFiles(userOrEmail) {
    return isStation1Admin(userOrEmail) || isStation4Admin(userOrEmail);
}

export function canHandleDepartmentRelease(userOrEmail, department) {
    const normalizedDept = String(department || 'PSA').trim().toLowerCase();
    return normalizedDept === 'philsys' ? isStation1Admin(userOrEmail) : isStation4Admin(userOrEmail);
}
