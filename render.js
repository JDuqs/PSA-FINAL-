// UI Rendering Logic (Tables, Badges, Modals)
import { state } from './state.js';
import { isAnyAdmin, ADMIN_ROLES } from './config.js';
import { showConfirm } from './utils.js';
import { supabase } from './config.js';

// ==============================================================
// ADVANCED KIT SWAP LOGIC (Dynamically overrides old HTML modal)
// ==============================================================
window.openEditKitModal = async function(gatePassId, encodedDesc, mainKitSerial) {
    const desc = decodeURIComponent(encodedDesc);
    window.currentEditItemId = gatePassId;
    window.currentMainKitSerial = mainKitSerial;

    let modalEl = document.getElementById('advancedEditKitModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'advancedEditKitModal';
        modalEl.className = 'modal fade';
        modalEl.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title fw-bold"><i class="fa fa-right-left me-2"></i> Swap & Edit Kit Components</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light p-4" id="advancedEditKitBody">
                        <div class="text-center py-4"><i class="fa fa-spinner fa-spin fa-2x text-warning"></i><p class="mt-2 text-muted">Loading available components...</p></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
    }

    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Load inventory to allow swapping
    const { data: inventory, error } = await supabase.from('philsys_inventory').select('*');
    if (error) {
        document.getElementById('advancedEditKitBody').innerHTML = `<div class="alert alert-danger">Failed to load inventory for swapping.</div>`;
        return;
    }

    // Parse existing description to populate the form cleanly, separating out borrow tags
    const parts = desc.split('|').map(p => p.trim());
    const currentParts = { laptopModel: '', laptopSerial: '', laptopMeta: '', scanner: '', scannerMeta: '', iris: '', irisMeta: '', webcam: '', webcamMeta: '', docScan: '', docScanMeta: '', monitor: '', monitorMeta: '', printer: '', printerMeta: '' };
    
    parts.forEach(part => {
        const snMatchRegex = /\[SN:\s*(.*?)\]/i;
        const match = part.match(snMatchRegex);
        let sn = match ? match[1].trim() : '';
        let meta = '';
        
        // Strip out the hidden {borrowed_from...} tag from the UI input so it looks clean
        if (sn.includes('{borrowed_from')) {
            const braceIdx = sn.indexOf('{');
            meta = sn.substring(braceIdx);
            sn = sn.substring(0, braceIdx).trim();
        }
        
        const lowerPart = part.toLowerCase();
        if (lowerPart.startsWith('laptop')) {
            const modelMatch = part.match(/Laptop:\s*(.*?)\s*\[/i);
            currentParts.laptopModel = modelMatch ? modelMatch[1].trim() : '';
            currentParts.laptopSerial = sn;
            currentParts.laptopMeta = meta;
        } 
        else if (lowerPart.startsWith('scanner')) { currentParts.scanner = sn; currentParts.scannerMeta = meta; }
        else if (lowerPart.startsWith('iris')) { currentParts.iris = sn; currentParts.irisMeta = meta; }
        else if (lowerPart.startsWith('webcam')) { currentParts.webcam = sn; currentParts.webcamMeta = meta; }
        else if (lowerPart.startsWith('doc scan')) { currentParts.docScan = sn; currentParts.docScanMeta = meta; }
        else if (lowerPart.startsWith('monitor')) { currentParts.monitor = sn; currentParts.monitorMeta = meta; }
        else if (lowerPart.startsWith('printer')) { currentParts.printer = sn; currentParts.printerMeta = meta; }
    });

    // Helper to generate <select> options mapping inventory items
    const generateOptions = (compKey, currentSn) => {
        let options = `<option value="${currentSn}" selected>Keep Current: ${currentSn || 'N/A'}</option>`;
        options += `<option value="NONE">Mark as NONE / Missing</option>`;
        options += `<optgroup label="Available in other kits">`;
        inventory.forEach(kit => {
            if (kit.kit_serial !== mainKitSerial) {
                const sn = kit[compKey];
                // Hide items that are missing, defective, or already borrowed by someone else
                if (sn && sn !== 'N/A' && sn !== 'NONE' && !sn.includes('DEFECTIVE') && !sn.includes('BORROWED')) {
                    options += `<option value="${sn}" data-source-kit="${kit.kit_serial}">Swap with SN: ${sn} (from Kit: ${kit.kit_serial})</option>`;
                }
            }
        });
        options += `</optgroup>`;
        return options;
    };

    const formHtml = `
        <div class="alert alert-warning border-warning shadow-sm mb-4 small">
            <i class="fa fa-info-circle me-2"></i> Select a working component from another kit to swap. The broken/missing item will be transferred to that source kit automatically and marked out. It will return when the batch is finished.
        </div>
        <form id="advEditKitForm">
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="small fw-bold text-secondary">Laptop Model</label>
                    <input type="text" id="advLaptopModel" class="form-control bg-light" value="${currentParts.laptopModel}" readonly tabindex="-1">
                </div>
                <div class="col-md-6">
                    <label class="small fw-bold text-secondary">Laptop Serial No.</label>
                    <select id="advLaptopSerial" class="form-select border-warning" data-comp="laptop_sn">${generateOptions('laptop_sn', currentParts.laptopSerial)}</select>
                </div>

                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Scanner Serial No.</label>
                    <select id="advScannerSerial" class="form-select border-warning" data-comp="scanner_sn">${generateOptions('scanner_sn', currentParts.scanner)}</select>
                </div>
                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Iris Scanner SN</label>
                    <select id="advIrisSerial" class="form-select border-warning" data-comp="iris_sn">${generateOptions('iris_sn', currentParts.iris)}</select>
                </div>
                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Webcam SN</label>
                    <select id="advWebcamSerial" class="form-select border-warning" data-comp="webcam_sn">${generateOptions('webcam_sn', currentParts.webcam)}</select>
                </div>

                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Doc Scanner SN</label>
                    <select id="advDocScannerSerial" class="form-select border-warning" data-comp="doc_scanner_sn">${generateOptions('doc_scanner_sn', currentParts.docScan)}</select>
                </div>
                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Monitor SN</label>
                    <select id="advMonitorSerial" class="form-select border-warning" data-comp="monitor_sn">${generateOptions('monitor_sn', currentParts.monitor)}</select>
                </div>
                <div class="col-md-4">
                    <label class="small fw-bold text-secondary">Printer SN</label>
                    <select id="advPrinterSerial" class="form-select border-warning" data-comp="printer_sn">${generateOptions('printer_sn', currentParts.printer)}</select>
                </div>

                <div class="col-12 mt-4">
                    <button type="button" id="btnSaveAdvKitEdits" class="btn btn-warning w-100 fw-bold py-2 shadow-sm fs-6">
                        <i class="fa fa-save me-2"></i> SAVE CHANGES & SWAPS
                    </button>
                </div>
            </div>
        </form>
    `;

    document.getElementById('advancedEditKitBody').innerHTML = formHtml;

    // --- NEW: Auto-update Laptop Model when changing Laptop Serial ---
    document.getElementById('advLaptopSerial').addEventListener('change', (e) => {
        const selectedSn = e.target.value;
        if (selectedSn === 'NONE') {
            document.getElementById('advLaptopModel').value = 'N/A';
        } else if (selectedSn === currentParts.laptopSerial) {
            document.getElementById('advLaptopModel').value = currentParts.laptopModel;
        } else {
            const matchedKit = inventory.find(k => k.laptop_sn === selectedSn);
            if (matchedKit && matchedKit.laptop_model) {
                document.getElementById('advLaptopModel').value = matchedKit.laptop_model;
            }
        }
    });
    // -----------------------------------------------------------------

    document.getElementById('btnSaveAdvKitEdits').addEventListener('click', async () => {
        const btn = document.getElementById('btnSaveAdvKitEdits');
        btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> PROCESSING SWAPS...`;
        btn.disabled = true;

        try {
            const selections = {
                laptop: { val: document.getElementById('advLaptopSerial').value, old: currentParts.laptopSerial, meta: currentParts.laptopMeta, opt: document.getElementById('advLaptopSerial').selectedOptions[0], key: 'laptop_sn' },
                scanner: { val: document.getElementById('advScannerSerial').value, old: currentParts.scanner, meta: currentParts.scannerMeta, opt: document.getElementById('advScannerSerial').selectedOptions[0], key: 'scanner_sn' },
                iris: { val: document.getElementById('advIrisSerial').value, old: currentParts.iris, meta: currentParts.irisMeta, opt: document.getElementById('advIrisSerial').selectedOptions[0], key: 'iris_sn' },
                webcam: { val: document.getElementById('advWebcamSerial').value, old: currentParts.webcam, meta: currentParts.webcamMeta, opt: document.getElementById('advWebcamSerial').selectedOptions[0], key: 'webcam_sn' },
                docScan: { val: document.getElementById('advDocScannerSerial').value, old: currentParts.docScan, meta: currentParts.docScanMeta, opt: document.getElementById('advDocScannerSerial').selectedOptions[0], key: 'doc_scanner_sn' },
                monitor: { val: document.getElementById('advMonitorSerial').value, old: currentParts.monitor, meta: currentParts.monitorMeta, opt: document.getElementById('advMonitorSerial').selectedOptions[0], key: 'monitor_sn' },
                printer: { val: document.getElementById('advPrinterSerial').value, old: currentParts.printer, meta: currentParts.printerMeta, opt: document.getElementById('advPrinterSerial').selectedOptions[0], key: 'printer_sn' }
            };

            const laptopModel = document.getElementById('advLaptopModel').value.trim();
            const partsOut = [];

            // Helper to build the description string while maintaining the borrow tags
            const buildPart = (label, compObj) => {
                let snVal = compObj.val === 'NONE' ? 'N/A' : compObj.val;
                const sourceKit = compObj.opt.getAttribute('data-source-kit');
                
                if (sourceKit) {
                    // New swap occurred, tag it so workflow.js can return it later
                    snVal += ` {borrowed_from: ${sourceKit}, old: ${compObj.old || 'NONE'}}`;
                } else if (compObj.val === compObj.old && compObj.meta) {
                    // Item unchanged, keep the existing borrow tag attached
                    snVal += ` ${compObj.meta}`;
                }
                return `${label} [SN: ${snVal}]`;
            };

            // 1. Build new gate pass description
            if (laptopModel || (selections.laptop.val && selections.laptop.val !== 'NONE')) {
                let snVal = selections.laptop.val === 'NONE' ? 'N/A' : selections.laptop.val;
                const sourceKit = selections.laptop.opt.getAttribute('data-source-kit');
                if (sourceKit) {
                    snVal += ` {borrowed_from: ${sourceKit}, old: ${selections.laptop.old || 'NONE'}}`;
                } else if (selections.laptop.val === selections.laptop.old && selections.laptop.meta) {
                    snVal += ` ${selections.laptop.meta}`;
                }
                partsOut.push(`Laptop: ${laptopModel || 'N/A'} [SN: ${snVal}]`);
            }
            
            if (selections.scanner.val && selections.scanner.val !== 'NONE') partsOut.push(buildPart('Scanner', selections.scanner));
            if (selections.iris.val && selections.iris.val !== 'NONE') partsOut.push(buildPart('Iris', selections.iris));
            if (selections.webcam.val && selections.webcam.val !== 'NONE') partsOut.push(buildPart('Webcam', selections.webcam));
            if (selections.docScan.val && selections.docScan.val !== 'NONE') partsOut.push(buildPart('Doc Scan', selections.docScan));
            if (selections.monitor.val && selections.monitor.val !== 'NONE') partsOut.push(buildPart('Monitor', selections.monitor));
            if (selections.printer.val && selections.printer.val !== 'NONE') partsOut.push(buildPart('Printer', selections.printer));

            const finalDescription = partsOut.length > 0 ? partsOut.join(' | ') : 'Luggage Kit (No internal serials specified)';

            // 2. Perform DB updates for inventory swaps
            for (const comp of Object.values(selections)) {
                const sourceKit = comp.opt.getAttribute('data-source-kit');
                
                if (sourceKit) {
                    // Update the current requesting kit with the working item
                    const newValForMainKit = comp.val === 'NONE' ? 'NONE' : comp.val;
                    await supabase.from('philsys_inventory').update({ [comp.key]: newValForMainKit }).eq('kit_serial', mainKitSerial);

                    // Mark the source kit's item as borrowed so no one else touches it
                    const oldValForSourceKit = comp.old && comp.old !== 'N/A' && comp.old !== 'NONE' ? comp.old : 'MISSING';
                    await supabase.from('philsys_inventory').update({ [comp.key]: `BORROWED BY ${mainKitSerial} (Was: ${oldValForSourceKit})` }).eq('kit_serial', sourceKit);
                }
            }

            // 3. Update Gate Pass description
            const { error: gpErr } = await supabase
                .from('gate_passes')
                .update({ description: finalDescription })
                .eq('id', window.currentEditItemId);
            
            if (gpErr) throw gpErr;

            modal.hide();
            alert("Kit components swapped and databases updated successfully!");
            if(window.refreshTableData) window.refreshTableData();

        } catch(e) {
            alert("Error saving: " + e.message);
        } finally {
            btn.innerHTML = `<i class="fa fa-save me-2"></i> SAVE CHANGES & SWAPS`;
            btn.disabled = false;
        }
    });
};
// ==============================================================


export function populateReturnSelector() {
    const selector = document.getElementById('returnBatchID');
    if (!selector) return;

    // Filter active returns based on Admin Role
    let displayData = state.activeData;
    if (state.currentUser && state.currentUser.email === ADMIN_ROLES.STATION_1) {
        displayData = state.activeData.filter(i => i.department === 'PhilSys' || (i.project && i.project.toLowerCase().includes('philsys')));
    } else if (state.currentUser && state.currentUser.email === ADMIN_ROLES.STATION_4) {
        displayData = state.activeData.filter(i => i.department !== 'PhilSys' && !(i.project && i.project.toLowerCase().includes('philsys')));
    }

    const batches = displayData.reduce((acc, item) => {
        if (!acc[item.unique_id]) { acc[item.unique_id] = { id: item.unique_id, borrower: item.borrower }; }
        return acc;
    }, {});

    const batchKeys = Object.keys(batches);
    const currentSignature = JSON.stringify(batchKeys.sort());
    const isLoading = selector.options[0]?.text.includes("Loading");
    if (!isLoading && currentSignature === state.signatures.selector) return;

    state.signatures.selector = currentSignature;
    const previousVal = selector.value;
    
    if (batchKeys.length === 0) {
        selector.innerHTML = '<option value="" selected disabled>No Active Batches Found</option>';
    } else {
        selector.innerHTML = '<option value="" selected disabled>Select Batch to Return...</option>';
        Object.values(batches).sort((a,b) => b.id.localeCompare(a.id, undefined, { numeric: true })).forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.text = `${b.id} - ${b.borrower}`;
            selector.appendChild(opt);
        });
    }
    if (previousVal && batches[previousVal]) selector.value = previousVal;
}

export function updateNavBadges(user) {
    // --- ENSURE CORRECT TABS ARE VISIBLE FOR ROLES ---
    // Actively overrides CSS hiding so Admin 1 can see both Station 1, Station 4, and the Return section
    if (user && (user.email === ADMIN_ROLES.STATION_1 || user.email === ADMIN_ROLES.STATION_4)) {
        const returnSection = document.getElementById('returnSection');
        if (returnSection) returnSection.style.display = 'block';
    }

    if (user && user.email === ADMIN_ROLES.STATION_1) {
        const stn1Tab = document.getElementById('nav-stn1');
        const stn4Tab = document.getElementById('nav-stn4');
        if (stn1Tab) stn1Tab.style.display = 'block';
        if (stn4Tab) stn4Tab.style.display = 'block';
    }

    const approvalsBtn = document.querySelector('.nav-item-btn[data-target="view-approvals"]');
    if(approvalsBtn) {
        let count = 0;
        if(isAnyAdmin(user.email)) {
            if(user.email === ADMIN_ROLES.STATION_1) {
                const s1Count = new Set(state.station1Data.map(i => i.unique_id)).size;
                const philsysReleasing = state.releasingData.filter(i => i.department === 'PhilSys' || (i.project && i.project.toLowerCase().includes('philsys')));
                const relCount = new Set(philsysReleasing.map(i => i.unique_id)).size;
                count = s1Count + relCount; 
            }
            else if(user.email === ADMIN_ROLES.STATION_2) count = new Set(state.station2Data.map(i => i.unique_id)).size;
            else if(user.email === ADMIN_ROLES.STATION_3) count = new Set(state.station3Data.map(i => i.unique_id)).size;
            else if(user.email === ADMIN_ROLES.STATION_4) {
                const psaReleasing = state.releasingData.filter(i => i.department !== 'PhilSys' && !(i.project && i.project.toLowerCase().includes('philsys')));
                count = new Set(psaReleasing.map(i => i.unique_id)).size;
            }
            if(user.email === ADMIN_ROLES.VIEWER || user.email === ADMIN_ROLES.VIEWER2) {
                const allPending = [...state.station1Data, ...state.station2Data, ...state.station3Data, ...state.releasingData];
                count = new Set(allPending.map(i => i.unique_id)).size;
            }
        } else {
            const userPending = [...state.station1Data, ...state.station2Data, ...state.station3Data, ...state.releasingData];
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

    // Active Gate Pass Badge
    const recordsBtn = document.querySelector('.nav-item-btn[data-target="view-records"]');
    if (recordsBtn) {
        const uniqueActiveBatches = new Set(state.activeData.map(item => item.unique_id));
        const activeCount = uniqueActiveBatches.size;
        let activeBadge = recordsBtn.querySelector('.badge');
        if (!activeBadge) {
            activeBadge = document.createElement('span');
            activeBadge.className = 'badge bg-primary rounded-pill ms-2';
            recordsBtn.appendChild(activeBadge);
        }
        if (activeCount > 0) {
            activeBadge.innerText = activeCount;
            activeBadge.style.display = 'inline-block';
        } else {
            activeBadge.style.display = 'none';
        }
    }
    renderNotifications();
}

export function renderNotifications() {
    const localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + state.currentUser.email) || '[]');
    const currentSignature = JSON.stringify(localNotifs);
    if(currentSignature === state.signatures.rejected) return; 
    state.signatures.rejected = currentSignature;

    const count = localNotifs.length;

    let notifBtn = document.getElementById('userNotifBtn');
    if(!notifBtn && count > 0) {
        const userDisplay = document.getElementById('currentUserDisplay');
        if(userDisplay) {
            notifBtn = document.createElement('button');
            notifBtn.id = 'userNotifBtn';
            notifBtn.className = 'btn btn-link text-dark position-relative me-3 p-0 border-0 text-decoration-none';
            notifBtn.innerHTML = `<i class="fa fa-bell fs-5"></i><span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" id="notifBadge" style="font-size: 0.6rem;">0</span>`;
            notifBtn.onclick = window.showNotificationsModal; 
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

export function showNotificationsModal() {
    let modalEl = document.getElementById('notificationsModal');
    if(!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'notificationsModal';
        modalEl.className = 'modal fade';
        modalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title fw-bold"><i class="fa fa-bell me-2"></i> System Notifications</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light" id="notifModalBody" style="max-height: 60vh; overflow-y: auto;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
    }

    const localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + state.currentUser.email) || '[]');
    const body = document.getElementById('notifModalBody');
    
    if(localNotifs.length === 0) {
        body.innerHTML = `<div class="text-muted text-center py-4"><i class="fa fa-envelope-open fa-2x mb-2 opacity-50"></i><p class="mb-0">No new notifications.</p></div>`;
    } else {
        body.innerHTML = localNotifs.map(n => {
            const icon = n.type === 'REJECTED' ? '<i class="fa fa-ban me-1"></i>' : '<i class="fa fa-check-circle me-1"></i>';
            const color = n.type === 'REJECTED' ? 'danger' : 'success';
            const title = n.type === 'REJECTED' ? `Request Denied / Cancelled` : `Request Accepted`;
            
            return `
            <div class="alert alert-${color} mb-2 border-${color} d-flex justify-content-between align-items-center shadow-sm">
                <div>
                    <h6 class="mb-1 text-${color} fw-bold">${icon} ${title}</h6>
                    <small class="text-dark">${n.message}</small>
                </div>
                <button class="btn btn-sm btn-outline-${color} ms-3 text-nowrap" onclick="window.dismissNotification('${n.id}')">Dismiss</button>
            </div>
            `;
        }).join('');
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

export async function dismissNotification(notifId) {
    try {
        let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + state.currentUser.email) || '[]');
        localNotifs = localNotifs.filter(item => item.id !== notifId);
        localStorage.setItem('psa_notifications_' + state.currentUser.email, JSON.stringify(localNotifs));
        
        showNotificationsModal(); 
        renderNotifications(); 
    } catch(e) { alert(e.message); }
}

export function renderStationTable(data, tbodyId, badgeId, currentStatus, canApprove) {
    const tbody = document.getElementById(tbodyId);
    const badge = document.getElementById(badgeId);
    if(!tbody) return;

    const currentSignature = JSON.stringify(data);
    let sigKey = "";
    if (currentStatus === 'PENDING_PROPERTY') sigKey = "station1";
    else if (currentStatus === 'PENDING_INSPECTION') sigKey = "station2";
    else if (currentStatus === 'PENDING_OIC') sigKey = "station3";
    
    if (sigKey && currentSignature === state.signatures[sigKey] && tbody.innerHTML.trim() !== "") return;
    if (sigKey) state.signatures[sigKey] = currentSignature;

    const openAccordions = Array.from(document.querySelectorAll(`#${tbodyId} .collapse.show`)).map(el => el.id);

    let config = { btnText: "Approve", badgeClass: "bg-secondary", borderClass: "border-secondary" };
    if (currentStatus === 'PENDING_PROPERTY') { config = { btnText: "Approve (Property)", badgeClass: "bg-secondary", borderClass: "border-secondary" }; } 
    else if (currentStatus === 'PENDING_INSPECTION') { config = { btnText: "Approve (Inspection)", badgeClass: "bg-info", borderClass: "border-info" }; } 
    else if (currentStatus === 'PENDING_OIC') { config = { btnText: "Approve (OIC)", badgeClass: "bg-warning", borderClass: "border-warning" }; }

    if (badge) {
        const uniqueBatches = new Set(data.map(item => item.unique_id));
        const batchCount = uniqueBatches.size;

        if (batchCount > 0) {
            badge.innerText = batchCount;
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

    const canExportHere = isAnyAdmin(state.currentUser.email);
    const canRemoveItems = (state.currentUser.email === ADMIN_ROLES.STATION_1 || state.currentUser.email === ADMIN_ROLES.STATION_4);
    
    // Grouping includes the department indicator
    const groups = data.reduce((acc, item) => {
        if (!acc[item.unique_id]) { 
            acc[item.unique_id] = { 
                id: item.unique_id, 
                borrower: item.borrower, 
                project: item.project, 
                date: item.due_date, 
                status: item.status, 
                destination: item.destination, 
                department: item.department || 'PSA', 
                items: [] 
            }; 
        }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    Object.values(groups).forEach(group => {
        group.items.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));
        
        const batchId = group.id;
        const itemCount = group.items.length;
        const safeBatchId = batchId.replace(/[^a-zA-Z0-9]/g, "_") + "_" + currentStatus; 
        
        // Department Badge (Green for PhilSys, Blue for PSA)
        const deptBadgeClass = group.department === 'PhilSys' ? 'bg-success' : 'bg-primary';
        const deptBadge = `<span class="badge ${deptBadgeClass} ms-2 shadow-sm" style="font-size: 0.65rem; vertical-align: middle;">${group.department}</span>`;

        let actionBtns = '';
        if (canApprove) {
            actionBtns = `
                <button class="btn btn-primary btn-sm me-1 fw-bold" onclick="window.approveBatch('${batchId}', '${currentStatus}')"><i class="fa fa-arrow-right me-1"></i> ${config.btnText}</button>`;
        } else if (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2) {
             actionBtns = `<span class="badge bg-light text-secondary border">View Only</span>`;
        } else {
             actionBtns = `<span class="badge bg-light text-secondary border">Pending</span>`;
        }

        if (canExportHere) {
            actionBtns += `<button class="btn btn-outline-success btn-sm ms-1" onclick="window.triggerExportModal('${batchId}', '${currentStatus}')" title="Export this batch"><i class="fa fa-file-export"></i></button>`;
        }

        const summaryRow = `
            <tr class="table-light border-bottom border-2 ${config.borderClass}">
                <td class="fw-bold text-primary">
                    <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold d-flex align-items-center" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${safeBatchId}" aria-expanded="false">
                        <i class="fa fa-chevron-right me-2 small"></i>${batchId} ${deptBadge}
                    </button>
                </td>
                <td class="fw-bold">${group.borrower}</td>
                <td><span class="badge ${config.badgeClass} text-dark">${itemCount} Items</span></td>
                <td>${group.destination}</td>
                <td>${group.project}</td>
                <td>${group.date}</td>
                <td class="text-center text-nowrap">${actionBtns}</td>
            </tr>`;
        
        const itemRows = group.items.map(item => {
            const isKit = item.asset_no === 'Luggage Kit' || (item.description && item.description.includes('[SN:'));
            const isStation1Admin = state.currentUser.email === ADMIN_ROLES.STATION_1;
            
            let itemActionBtns = '';
            
            // Add Edit Kit Button for Station 1 Admins using robust encodeURIComponent escaping
            if (isKit && isStation1Admin) {
                const safeDesc = encodeURIComponent(item.description || '');
                itemActionBtns += `<button class="btn btn-outline-warning btn-sm py-0 me-1" style="font-size:0.7rem" onclick="window.openEditKitModal('${item.id}', '${safeDesc}', '${item.serial}')"><i class="fa fa-pen me-1"></i> Swap Kit</button>`;
            }
            
            if (canRemoveItems) {
                itemActionBtns += `<button class="btn btn-outline-danger btn-sm py-0" style="font-size:0.7rem" onclick="window.rejectRequest('${item.id}')"><i class="fa fa-times me-1"></i> Reject Item</button>`;
            }

            return `
            <tr>
                <td class="text-muted ps-4"><small>${item.serial}</small></td>
                <td colspan="2"><small>${item.description.replace(/{borrowed_from:[^}]+}/g, '<span class="badge bg-warning text-dark border ms-1" style="font-size:0.6rem;">Swapped</span>')}</small></td>
                <td><small>${item.asset_no || '-'}</small></td>
                <td colspan="2"><small class="text-muted">Prop No: ${item.property_no || '-'}</small></td>
                <td class="text-center text-nowrap">${itemActionBtns}</td>
            </tr>`;
        }).join('');

        tbody.innerHTML += summaryRow + `<tr><td colspan="8" class="p-0 border-0"><div class="collapse bg-white" id="collapse-${safeBatchId}"><table class="table table-sm mb-0 table-borderless bg-light bg-opacity-10"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th colspan="2">Description</th><th>Asset</th><th colspan="2">Property No</th><th class="text-center">Action</th></tr></thead><tbody>${itemRows}</tbody></table></div></td></tr>`;
    });

    openAccordions.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('show'); const btn = document.querySelector(`button[data-bs-target="#${id}"]`); if(btn) btn.setAttribute('aria-expanded', 'true'); }
    });
}

export function renderReleasingTable(canRelease) {
    const tbody = document.getElementById('releasingTableBody');
    const badge = document.getElementById('releasingCountBadge');
    if(!tbody) return;

    let displayData = state.releasingData;
    if (state.currentUser.email === ADMIN_ROLES.STATION_1) {
        displayData = state.releasingData.filter(i => i.department === 'PhilSys' || (i.project && i.project.toLowerCase().includes('philsys')));
    } else if (state.currentUser.email === ADMIN_ROLES.STATION_4) {
        displayData = state.releasingData.filter(i => i.department !== 'PhilSys' && !(i.project && i.project.toLowerCase().includes('philsys')));
    }

    const currentSignature = JSON.stringify(displayData);
    if (currentSignature === state.signatures.releasing && tbody.innerHTML.trim() !== "") return;
    state.signatures.releasing = currentSignature;
    
    const openAccordions = Array.from(document.querySelectorAll('#releasingTableBody .collapse.show')).map(el => el.id);
    tbody.innerHTML = "";
    
    if (badge) {
        const uniqueBatches = new Set(displayData.map(item => item.unique_id));
        const batchCount = uniqueBatches.size;
        
        badge.innerText = batchCount;
        badge.classList.toggle('d-none', batchCount === 0);
    }

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No items waiting for release.</td></tr>`;
        return;
    }

    const canSelect = isAnyAdmin(state.currentUser.email);
    const canRemoveItems = (state.currentUser.email === ADMIN_ROLES.STATION_1 || state.currentUser.email === ADMIN_ROLES.STATION_4);
    
    // Grouping includes the department indicator
    const groups = displayData.reduce((acc, item) => {
        if (!acc[item.unique_id]) { 
            acc[item.unique_id] = { 
                id: item.unique_id, 
                borrower: item.borrower, 
                destination: item.destination, 
                date: item.due_date, 
                project: item.project, 
                department: item.department || 'PSA', 
                items: [] 
            }; 
        }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    Object.values(groups).forEach(group => {
        group.items.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

        const batchId = group.id;
        const safeBatchId = batchId.replace(/[^a-zA-Z0-9]/g, "_");
        
        // Department Badge (Green for PhilSys, Blue for PSA)
        const deptBadgeClass = group.department === 'PhilSys' ? 'bg-success' : 'bg-primary';
        const deptBadge = `<span class="badge ${deptBadgeClass} ms-2 shadow-sm" style="font-size: 0.65rem; vertical-align: middle;">${group.department}</span>`;

        let actionBtns = '';
        const effectiveCanRelease = canRelease || state.currentUser.email === ADMIN_ROLES.STATION_1;

        if (effectiveCanRelease) {
            actionBtns = `
                <button class="btn btn-success btn-sm me-1 fw-bold" onclick="window.confirmReleaseBatch('${batchId}')"><i class="fa fa-box-open me-1"></i> Release</button>`;
        } else if (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2) {
             actionBtns = `<span class="badge bg-light text-secondary border">View Only</span>`;
        } else {
             actionBtns = `<span class="badge bg-primary text-white">Pending Release</span>`;
        }

        if (canSelect) { actionBtns += `<button class="btn btn-outline-success btn-sm ms-1" onclick="window.triggerExportModal('${batchId}', 'RELEASING')" title="Export this batch"><i class="fa fa-file-export"></i></button>`; }
        const checkboxContent = canSelect ? `<input type="checkbox" class="export-check form-check-input" value="${group.id}">` : `-`;

        const summaryRow = `
            <tr class="table-light border-bottom border-2 border-primary align-middle">
                <td class="text-center">${checkboxContent}</td>
                <td class="fw-bold text-primary">
                    <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold d-flex align-items-center" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-rel-${safeBatchId}">
                        <i class="fa fa-chevron-right me-2 small"></i>${batchId} ${deptBadge}
                    </button>
                </td>
                <td class="fw-bold">${group.borrower}</td>
                <td><span class="badge bg-secondary">${group.items.length} Items</span></td>
                <td>${group.destination}</td>
                <td>${group.date}</td>
                <td class="text-center text-nowrap">${actionBtns}</td>
            </tr>`;
        
        const itemRows = group.items.map(item => {
            const isKit = item.asset_no === 'Luggage Kit' || (item.description && item.description.includes('[SN:'));
            const isStation1Admin = state.currentUser.email === ADMIN_ROLES.STATION_1;
            
            let itemActionBtns = '';
            
            // Add Edit Kit Button using robust encodeURIComponent escaping
            if (isKit && isStation1Admin) {
                const safeDesc = encodeURIComponent(item.description || '');
                itemActionBtns += `<button class="btn btn-outline-warning btn-sm py-0 me-1" style="font-size:0.7rem" onclick="window.openEditKitModal('${item.id}', '${safeDesc}', '${item.serial}')"><i class="fa fa-pen me-1"></i> Swap Kit</button>`;
            }
            
            if (canRemoveItems) {
                itemActionBtns += `<button class="btn btn-outline-danger btn-sm py-0" style="font-size:0.7rem" onclick="window.rejectRequest('${item.id}')"><i class="fa fa-times me-1"></i> Reject Item</button>`;
            }

            return `
            <tr>
                <td class="text-muted ps-4"><small>${item.serial}</small></td>
                <td colspan="2"><small>${item.description.replace(/{borrowed_from:[^}]+}/g, '<span class="badge bg-warning text-dark border ms-1" style="font-size:0.6rem;">Swapped</span>')}</small></td>
                <td><small>${item.asset_no || '-'}</small></td>
                <td colspan="2"><small class="text-muted">Prop No: ${item.property_no || '-'}</small></td>
                <td class="text-center text-nowrap">${itemActionBtns}</td>
            </tr>`;
        }).join('');
        
        tbody.innerHTML += summaryRow + `<tr><td colspan="8" class="p-0 border-0"><div class="collapse bg-white" id="collapse-rel-${safeBatchId}"><table class="table table-sm mb-0 table-borderless bg-light bg-opacity-10"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th colspan="2">Description</th><th>Asset</th><th colspan="2">Property No</th><th class="text-center">Action</th></tr></thead><tbody>${itemRows}</tbody></table></div></td></tr>`;
    });

    openAccordions.forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('show'); document.querySelector(`button[data-bs-target="#${id}"]`)?.setAttribute('aria-expanded', 'true'); }});
}

export function renderArchiveTable() {
    const s = state.pagination.archive;
    const tbody = document.getElementById('archiveTableBody');
    if(!tbody) return;

    let filteredData = [...(state.archiveData || [])];
    
    filteredData.sort((a, b) => {
        const idA = a.unique_id || "";
        const idB = b.unique_id || "";
        return idB.localeCompare(idA, undefined, { numeric: true });
    });

    if (s.filter) {
        const term = s.filter.toLowerCase();
        filteredData = filteredData.filter(i => 
            (i.unique_id && i.unique_id.toLowerCase().includes(term)) ||
            (i.issuer_email && i.issuer_email.toLowerCase().includes(term))
        );
    }

    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / s.limit) || 1;
    if (s.page > totalPages) s.page = totalPages;

    const start = (s.page - 1) * s.limit;
    const paginated = filteredData.slice(start, start + s.limit);

    const sig = JSON.stringify(paginated);
    if (sig === state.signatures.archive && tbody.innerHTML !== "") return;
    state.signatures.archive = sig;

    tbody.innerHTML = "";
    if (paginated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No scanned archives found.</td></tr>`;
    } else {
        const isAdmin = isAnyAdmin(state.currentUser.email) && state.currentUser.email !== ADMIN_ROLES.VIEWER && state.currentUser.email !== ADMIN_ROLES.VIEWER2;
        paginated.forEach(item => {
            const actionBtn = isAdmin ? `<button class="btn btn-outline-danger btn-sm" onclick="window.rejectBatch('${item.unique_id}', 'ARCHIVED')" title="Delete Archive"><i class="fa fa-trash"></i></button>` : '<span class="text-muted">-</span>';
            const deptBadgeClass = item.department === 'PhilSys' ? 'bg-success' : 'bg-primary';
            const deptBadge = `<span class="badge ${deptBadgeClass} ms-2 shadow-sm" style="font-size: 0.65rem; vertical-align: middle;">${item.department || 'PSA'}</span>`;

            tbody.innerHTML += `
            <tr class="align-middle">
                <td class="fw-bold text-primary d-flex align-items-center">${item.unique_id} ${deptBadge}</td>
                <td><small>${new Date(item.time_return).toLocaleString()}</small></td>
                <td><small class="text-muted">${item.issuer_email}</small></td>
                <td><a href="${item.return_receipt_url}" target="_blank" class="btn btn-sm btn-outline-primary py-1"><i class="fa fa-file-pdf me-1"></i> View Document</a></td>
                <td class="text-center">${actionBtn}</td>
            </tr>
            `;
        });
    }
    renderPaginationControls('archive', totalItems, totalPages);
}

export function renderTable(type) {
    const s = state.pagination[type];
    const rawData = type === 'active' ? state.activeData : state.historyData;
    const tbody = document.getElementById(type === 'active' ? 'activeTableBody' : 'historyTableBody');
    if (!tbody) return;
    
    // Grouping includes the department indicator
    const groups = rawData.reduce((acc, item) => {
        if (!acc[item.unique_id]) { 
            acc[item.unique_id] = { 
                id: item.unique_id, 
                borrower: item.borrower, 
                project: item.project, 
                date: type === 'active' ? item.time_out : item.time_return, 
                guard: type === 'active' ? item.guard_out : item.guard_in, 
                dueDate: item.due_date, 
                returnPdfUrl: item.return_receipt_url, 
                releasePdfUrl: item.release_pdf_url, 
                department: item.department || 'PSA', // ADDED DEPARTMENT
                items: [] 
            }; 
        }
        acc[item.unique_id].items.push(item);
        return acc;
    }, {});

    let groupArray = Object.values(groups);
    if (s.filter) {
        const term = s.filter.toLowerCase();
        groupArray = groupArray.filter(g => {
            return [g.id, g.borrower, g.project].some(v => v && String(v).toLowerCase().includes(term)) || 
                   g.items.some(i => [i.serial, i.description].some(v => v && String(v).toLowerCase().includes(term)));
        });
    }
    groupArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalItems = groupArray.length;
    const totalPages = Math.ceil(totalItems / s.limit);
    if (s.page > totalPages) s.page = Math.max(1, totalPages);
    
    const start = (s.page - 1) * s.limit;
    const paginatedGroups = groupArray.slice(start, start + s.limit);
    
    const currentSignature = JSON.stringify(paginatedGroups.map(g => ({ id: g.id, count: g.items.length, status: g.items[0]?.status, due: g.dueDate, pdf: g.returnPdfUrl, relPdf: g.releasePdfUrl, dept: g.department })));
    if (type === 'active') { if (currentSignature === state.signatures.active && tbody.innerHTML.trim() !== "") return; state.signatures.active = currentSignature; } 
    else { if (currentSignature === state.signatures.history && tbody.innerHTML.trim() !== "") return; state.signatures.history = currentSignature; }

    const openAccordions = Array.from(document.querySelectorAll(`#${tbody.id} .collapse.show`)).map(el => el.id);

    tbody.innerHTML = "";
    if (paginatedGroups.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">No records found.</td></tr>`; } 
    else {
        const today = new Date().toISOString().split('T')[0];
        const isAdmin = isAnyAdmin(state.currentUser.email);
        const isViewer = (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2);
        
        paginatedGroups.forEach(group => {
            group.items.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

            const safeBatchId = group.id.replace(/[^a-zA-Z0-9]/g, "_");
            const itemCount = group.items.length;
            
            // Department Badge (Green for PhilSys, Blue for PSA)
            const deptBadgeClass = group.department === 'PhilSys' ? 'bg-success' : 'bg-primary';
            const deptBadge = `<span class="badge ${deptBadgeClass} ms-2 shadow-sm" style="font-size: 0.65rem; vertical-align: middle;">${group.department}</span>`;

            let statusBadge = '';
            let dueCell = '';
            let attachmentCell = ''; 

            if (type === 'active') {
                if (group.dueDate && group.dueDate < today) statusBadge = '<span class="badge bg-danger">OVERDUE</span>';
                else if (group.dueDate === today) statusBadge = '<span class="badge bg-warning text-dark">DUE TODAY</span>';
                else statusBadge = '<span class="badge bg-primary">OUT</span>';

                if (isAdmin && !isViewer) {
                    dueCell = `<input type="date" class="form-control form-control-sm border-warning" value="${group.dueDate || ''}" onchange="window.updateBatchDueDate('${group.id}', this.value)" onclick="event.stopPropagation()">`;
                } else { dueCell = group.dueDate || '-'; }
                
                if (group.releasePdfUrl) {
                    attachmentCell = `<a href="${group.releasePdfUrl}" target="_blank" class="btn btn-sm btn-outline-primary py-0 fw-bold" style="font-size: 0.75rem;"><i class="fa fa-file-pdf me-1"></i>Signed Pass</a>`;
                } else {
                    attachmentCell = `<span class="text-muted small">-</span>`;
                }
            } else {
                statusBadge = '<span class="badge bg-secondary">RETURNED</span>';
                dueCell = group.guard || '-'; 
                if (group.returnPdfUrl) { attachmentCell = `<a href="${group.returnPdfUrl}" target="_blank" class="btn btn-sm btn-outline-info py-0" style="font-size: 0.75rem;"><i class="fa fa-file-pdf me-1"></i>View Receipt</a>`; } 
                else { attachmentCell = `<span class="text-muted small">-</span>`; }
            }

            const canSelect = isAnyAdmin(state.currentUser.email);
            const checkboxContent = canSelect ? `<input type="checkbox" class="export-check form-check-input" value="${group.id}">` : `-`;

            const summaryRow = `
                <tr class="align-middle">
                    <td class="text-center">${checkboxContent}</td>
                    <td class="fw-bold text-primary">
                        <button class="btn btn-sm btn-link text-decoration-none p-0 fw-bold d-flex align-items-center" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${type}-${safeBatchId}" aria-expanded="false">
                            <i class="fa fa-chevron-right me-2 small"></i>${group.id} ${deptBadge}
                        </button>
                    </td>
                    <td class="fw-bold">${group.borrower}</td>
                    <td>${group.project}</td>
                    <td><small>${group.date ? new Date(group.date).toLocaleString() : '-'}</small></td>
                    <td><span class="badge bg-light text-dark border">${itemCount} Items</span></td>
                    <td>${dueCell}</td>
                    <td>${attachmentCell}</td>
                    <td>${statusBadge}</td>
                </tr>`;

            const itemRows = group.items.map(item => `
                <tr>
                    <td class="text-primary fw-bold ps-4" style="width:20%; cursor:pointer;" onclick="window.selectRow('${group.id}')"><i class="fa fa-arrow-turn-up me-1 small"></i><small>${item.serial}</small></td>
                    <td style="width:20%"><small>${item.description.replace(/{borrowed_from:[^}]+}/g, '<span class="badge bg-warning text-dark border ms-1" style="font-size:0.6rem;">Swapped</span>')}</small></td>
                    <td style="width:10%"><small>${item.asset_no || '-'}</small></td>
                    <td style="width:10%"><small class="text-muted">${item.property_no || '-'}</small></td>
                    <td style="width:15%"><small>${item.destination}</small></td>
                    ${type === 'active' ? `<td style="width:15%"><small>${item.due_date||'-'}</small></td>` : ''}
                </tr>`).join('');

            tbody.innerHTML += summaryRow + `<tr><td colspan="9" class="p-0 border-0"><div class="collapse bg-white" id="collapse-${type}-${safeBatchId}"><div class="p-3 bg-light bg-opacity-10 border-bottom"><table class="table table-sm mb-0 table-borderless table-striped"><thead class="text-muted small border-bottom"><tr><th class="ps-4">Serial</th><th>Description</th><th>Asset</th><th>Property No</th><th>Destination</th>${type==='active'?'<th>Due</th>':''}</tr></thead><tbody>${itemRows}</tbody></table></div></div></td></tr>`;
        });
    }

    renderPaginationControls(type, totalItems, totalPages);
    
    openAccordions.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('show'); const toggler = document.querySelector(`button[data-bs-target="#${id}"]`); if (toggler) { toggler.classList.remove('collapsed'); toggler.setAttribute('aria-expanded', 'true'); } }
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
    
    if (!container) {
        const tbodyId = type === 'active' ? 'activeTableBody' : (type === 'history' ? 'historyTableBody' : 'archiveTableBody');
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return; 
        const tableDiv = tbody.closest('.table-responsive');
        if (!tableDiv) return;
        container = document.createElement('div'); container.id = containerId; container.className = "d-flex justify-content-between align-items-center mt-3 pt-2 border-top";
        tableDiv.after(container);
    }
    
    const s = state.pagination[type];
    container.innerHTML = `
        <div class="d-flex align-items-center gap-2"><span class="small text-muted">Show</span>
            <select class="form-select form-select-sm" style="width:70px" onchange="window.changeLimit('${type}', this.value)">
                <option value="5" ${s.limit==5?'selected':''}>5</option><option value="10" ${s.limit==10?'selected':''}>10</option>
                <option value="50" ${s.limit==50?'selected':''}>50</option>
            </select>
            <span class="small text-muted">Total: ${totalItems}</span>
        </div>
        <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary" onclick="window.changePage('${type}', -1)" ${s.page===1?'disabled':''}>Prev</button>
            <button class="btn btn-sm btn-outline-secondary disabled">Page ${s.page}</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="window.changePage('${type}', 1)" ${s.page>=totalPages?'disabled':''}>Next</button>
        </div>`;
}

export function updateUnifiedSelectionCount() {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let tableId = 'activeTableBody';
    if (activeViewId === 'view-approvals') { tableId = 'releasingTableBody'; } 
    else {
        const context = document.querySelector('#recordsTabs .nav-link.active')?.getAttribute('data-context') || 'active';
        tableId = context === 'active' ? 'activeTableBody' : (context === 'history' ? 'historyTableBody' : 'archiveTableBody');
    }
    const checkBoxes = document.querySelectorAll(`#${tableId} .export-check:checked`);
    const count = checkBoxes ? checkBoxes.length : 0;
    const countBadge = document.getElementById('unifiedSelectionCount');
    if (countBadge) countBadge.innerText = `${count} Selected`;
}

// Pagination & Filter Handlers
export function changeLimit(type, limit) { 
    state.pagination[type].limit = parseInt(limit); 
    state.pagination[type].page = 1; 
    if (type === 'archive') renderArchiveTable();
    else renderTable(type); 
}
export function changePage(type, dir) { 
    state.pagination[type].page += dir; 
    if (type === 'archive') renderArchiveTable();
    else renderTable(type); 
}

export async function updateBatchDueDate(batchId, newDate) {
    if (!batchId || !newDate) return;
    if (state.currentUser && (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2)) return alert("Read-Only Access.");
    if (!await showConfirm("Update Batch", `Update due date for ${batchId}?`)) return window.refreshTableData();
    try {
        const { error } = await supabase.from('gate_passes').update({ due_date: newDate }).eq('unique_id', batchId);
        if (error) throw error;
        window.refreshTableData();
    } catch (e) { alert("Update failed: " + e.message); }
}