// Data Loading & Refresh Logic
import { supabase, isAnyAdmin, ADMIN_ROLES } from './config.js';
import { state } from './state.js';
import { updateBorrowedStatus } from './inventory.js';
import { renderTable, renderArchiveTable, renderStationTable, renderReleasingTable, populateReturnSelector, updateUnifiedSelectionCount, updateNavBadges } from './render.js';

export function getSelectedIds(tbodyId) {
    const checked = document.querySelectorAll(`#${tbodyId} .export-check:checked`);
    return Array.from(checked).map(cb => cb.value); 
}

export async function loadOutPassesForGuard() {
    try {
        const { data, error } = await supabase
            .from('gate_passes')
            .select(`
                id, unique_id, borrower, project, time_out, due_date, status, serials (count)
            `)
            .not('status', 'eq', 'RETURNED')
            .not('status', 'eq', 'ARCHIVED')
            .order('time_out', { ascending: false, nullsFirst: false })
            .limit(200);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('Guard OUT load error:', e);
        return [];
    }
}

export function loadAllRecords() {
    const user = state.currentUser;
    const isAdmin = isAnyAdmin(user.email);
    
    const fetchRecords = async () => {
        try {
            const selectedBatchesActive = getSelectedIds('activeTableBody');
            const selectedBatchesHistory = getSelectedIds('historyTableBody');
            const selectedBatchesReleasing = getSelectedIds('releasingTableBody'); 
            
            const buildQuery = (status) => {
                let q = supabase.from('gate_passes').select('*').eq('status', status);
                if (!isAdmin) {
                    const email = user.email || "";
                    const name = state.currentUserName || "";
                    q = q.or(`issuer_email.eq."${email}",borrower.eq."${name}"`);
                }
                return q;
            };

            const { data: aData, error: aError } = await buildQuery('OUT').order('time_out', { ascending: false }).limit(500);
            if (aError) { console.error("Error loading active batches:", aError); state.activeData = []; } 
            else { state.activeData = aData || []; }
            
            populateReturnSelector(); 

            const { data: hData } = await buildQuery('RETURNED').order('time_return', { ascending: false }).limit(500);
            if(hData) state.historyData = hData;

            // NEW: Fetch ARCHIVED status records - Now ordered by unique_id (Gate Pass ID)
            const { data: archData } = await buildQuery('ARCHIVED').order('unique_id', { ascending: false }).limit(500);
            if(archData) state.archiveData = archData;

            const { data: s1Data } = await buildQuery('PENDING_PROPERTY').order('id', { ascending: false });
            if(s1Data) state.station1Data = s1Data;

            const { data: s2Data } = await buildQuery('PENDING_INSPECTION').order('id', { ascending: false });
            if(s2Data) state.station2Data = s2Data;

            const { data: s3Data } = await buildQuery('PENDING_OIC').order('id', { ascending: false });
            if(s3Data) state.station3Data = s3Data;

            const { data: rData } = await buildQuery('RELEASING').order('id', { ascending: false });
            if(rData) state.releasingData = rData;

            // NOTIFICATION POLLING MECHANISM
            const allFetched = [
                ...(state.station1Data || []),
                ...(state.station2Data || []),
                ...(state.station3Data || []),
                ...(state.releasingData || []),
                ...(state.activeData || [])
            ];

            let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + user.email) || '[]');
            let knownStatuses = JSON.parse(localStorage.getItem('psa_known_statuses_' + user.email) || '{}');
            let newNotifsAdded = false;

            allFetched.forEach(item => {
                if (item.issuer_email === user.email) {
                    const prevStatus = knownStatuses[item.id];
                    if (prevStatus && prevStatus !== item.status) {
                        if (['PENDING_INSPECTION', 'PENDING_OIC', 'RELEASING', 'OUT'].includes(item.status)) {
                            let statusText = item.status;
                            if (item.status === 'PENDING_INSPECTION') statusText = 'Approved by Property (Station 1)';
                            if (item.status === 'PENDING_OIC') statusText = 'Approved by Inspection (Station 2)';
                            if (item.status === 'RELEASING') statusText = 'Approved by OIC (Station 3) - Ready for Release';
                            if (item.status === 'OUT') statusText = 'Released (Active). Please pick up your items.';

                            const notifExists = localNotifs.some(n => n.batch_id === item.unique_id && n.status === item.status);
                            
                            if (!notifExists) {
                                localNotifs.unshift({
                                    id: Date.now().toString() + Math.random().toString(36).substring(2),
                                    batch_id: item.unique_id,
                                    type: 'ACCEPTED',
                                    status: item.status,
                                    message: `Batch ${item.unique_id}: ${statusText}`,
                                    timestamp: new Date().toISOString()
                                });
                                newNotifsAdded = true;
                            }
                        }
                    }
                    knownStatuses[item.id] = item.status;
                }
            });

            if (newNotifsAdded) {
                localStorage.setItem('psa_notifications_' + user.email, JSON.stringify(localNotifs));
            }
            localStorage.setItem('psa_known_statuses_' + user.email, JSON.stringify(knownStatuses));

            // Render tables and badges
            renderTable('active');
            renderTable('history');
            renderArchiveTable(); // NEW: Render Scanned Archives tab
            
            const canApproveStn1 = (user.email === ADMIN_ROLES.STATION_1);
            const canApproveStn2 = (user.email === ADMIN_ROLES.STATION_2);
            const canApproveStn3 = (user.email === ADMIN_ROLES.STATION_3);
            const canReleaseStn4 = (user.email === ADMIN_ROLES.STATION_4);

            renderStationTable(state.station1Data, 'station1TableBody', 'badgeStation1', 'PENDING_PROPERTY', canApproveStn1);
            renderStationTable(state.station2Data, 'station2TableBody', 'badgeStation2', 'PENDING_INSPECTION', canApproveStn2);
            renderStationTable(state.station3Data, 'station3TableBody', 'badgeStation3', 'PENDING_OIC', canApproveStn3);
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

        } catch (e) { 
            console.error("Error fetching records:", e); 
            if (state.activeData.length === 0) populateReturnSelector(); 
        }
    };

    fetchRecords();
    
    // Assign global refresh function
    window.refreshTableData = () => {
        // Reset signatures to force re-render
        state.signatures = { station1: "", station2: "", station3: "", releasing: "", active: "", history: "", archive: "", rejected: "", selector: "" };
        fetchRecords();
        updateBorrowedStatus();
    };

    setInterval(() => {
        if (!document.hidden) {
            fetchRecords();
            updateBorrowedStatus();
        }
    }, 5000);
}