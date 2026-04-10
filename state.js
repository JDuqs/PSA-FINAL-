// Centralized State Management
export const state = {
    cart: [],
    currentUserName: "",
    bulkImportData: [],
    currentSearchResults: [], 
    searchDebounceTimer: null, 
    borrowedSerials: new Set(), 
    currentUser: null, 
    currentExportContext: 'active', 
    tempReleaseBatchId: null, // Stores the ID of the batch currently being released via modal

    // Data Stores
    activeData: [],
    historyData: [],
    archiveData: [], // NEW: Store for scanned archives
    station1Data: [], 
    station2Data: [], 
    station3Data: [], 
    releasingData: [], 

    // Anti-Flicker Signatures
    signatures: {
        station1: "", 
        station2: "", 
        station3: "",
        releasing: "", 
        active: "",
        history: "",
        archive: "", // NEW: Signature for archives
        rejected: "",
        selector: ""
    },

    tempExportItems: null, // Store temp single batch for immediate exports

    pagination: {
        active: { page: 1, limit: 10, filter: '' },
        history: { page: 1, limit: 10, filter: '' },
        archive: { page: 1, limit: 10, filter: '' } // NEW: Pagination for archives
    }
};