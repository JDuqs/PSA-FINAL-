// 1. SUPABASE CONFIGURATION & CONSTANTS
const SUPABASE_URL = 'https://bnkqrvsfioadhgvhylur.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YzlzjTy_eTVFhXOOvfsAiQ_5bRGVzMi';
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// GLOBAL VARIABLES & ROLES
export const ADMIN_ROLES = {
    STATION_1: "admin1@psa.gov.ph", // Property - Can Export, Approve Stn 1
    STATION_2: "admin2@psa.gov.ph", // Inspection - Approve Stn 2 only
    STATION_3: "admin3@psa.gov.ph", // OIC - Approve Stn 3 only
    STATION_4: "admin@psa.gov.ph",  // Release/Main - Can Export, Approve Stn 4, Return, Manage Users
    VIEWER: "admin4@psa.gov.ph",    // Read-Only Admin - Can View All, NO Export, NO Import, No Changes
    VIEWER2: "admin5@psa.gov.ph"    // Read-Only Admin 2 - Same capabilities as VIEWER
};

export const ADMIN_NAMES = {
    "admin@psa.gov.ph": "Rigor S. Cubinor",
    "admin1@psa.gov.ph": "Jenor B. Blas",
    "admin2@psa.gov.ph": "Mary Anne G. Basilio",
    "admin3@psa.gov.ph": "Maricel M. Caragan",
    "admin4@psa.gov.ph": "Joemar P. Jerez",
    "admin5@psa.gov.ph": "Judie Rhisa G. Baluran"
};

// Helper: Check if email belongs to ANY admin
export const isAnyAdmin = (email) => Object.values(ADMIN_ROLES).includes(email);