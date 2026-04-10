// Workflow Logic: Issue, Approve, Release, Return, Historical Log
import { supabase, ADMIN_ROLES, isAnyAdmin } from './config.js';
import { state } from './state.js';
import { showConfirm, getNextGatePassID } from './utils.js';
import { renderCart } from './inventory.js';

// =========================================================================
// NEW: Auto-Restore Borrowed PhilSys Kit Components
// Automatically moves swapped/borrowed components back to their original 
// kits when a Gate Pass is returned or rejected/cancelled.
// =========================================================================
async function restoreBorrowedKits(items) {
    for (const item of items) {
        if (!item.description || !item.description.includes('{borrowed_from:')) continue;
        
        const mainKitSerial = item.serial;
        const parts = item.description.split('|');
        
        for (const part of parts) {
            if (!part.includes('{borrowed_from:')) continue;
            
            // Extract the original data using regex
            const match = part.match(/\[SN:\s*(.*?)\s*{borrowed_from:\s*(.*?),\s*old:\s*(.*?)}\]/i);
            if (!match) continue;
            
            const borrowedSn = match[1].trim();
            const sourceKit = match[2].trim();
            const oldSn = match[3].trim() === 'NONE' ? 'N/A' : match[3].trim();
            
            // Determine which column this belongs to
            const lowerPart = part.toLowerCase();
            let col = '';
            if (lowerPart.startsWith('laptop')) col = 'laptop_sn';
            else if (lowerPart.startsWith('scanner')) col = 'scanner_sn';
            else if (lowerPart.startsWith('iris')) col = 'iris_sn';
            else if (lowerPart.startsWith('webcam')) col = 'webcam_sn';
            else if (lowerPart.startsWith('doc scan')) col = 'doc_scanner_sn';
            else if (lowerPart.startsWith('monitor')) col = 'monitor_sn';
            else if (lowerPart.startsWith('printer')) col = 'printer_sn';
            
            if (col) {
                // 1. Return the working item back to the source kit
                await supabase.from('philsys_inventory').update({ [col]: borrowedSn }).eq('kit_serial', sourceKit);
                // 2. Return the old/defective item back to the main requesting kit
                await supabase.from('philsys_inventory').update({ [col]: oldSn }).eq('kit_serial', mainKitSerial);
            }
        }
    }
}

// Memory for auto-detected fields from the PDF
let tempDetectedDest = null;
let tempDetectedProj = null;
let tempRawPdfText = ""; 

export async function handleIssue() {
    const borrower = document.getElementById('borrower').value;
    const dest = document.getElementById('destination').value;
    const proj = document.getElementById('project').value;
    const due = document.getElementById('dueDate').value;

    if (!borrower || !dest || !due) return alert("Fill all required fields (Borrower, Destination, Due Date).");
    
    try {
        let phtToday;
        try {
            const timeRes = await fetch('https://worldtimeapi.org/api/timezone/Asia/Manila');
            if (timeRes.ok) {
                const timeData = await timeRes.json();
                phtToday = timeData.datetime.split('T')[0];
            } else {
                throw new Error("API fallback");
            }
        } catch (err) {
            phtToday = new Intl.DateTimeFormat('en-CA', { 
                timeZone: 'Asia/Manila', 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            }).format(new Date());
        }

        if (due < phtToday) {
            document.getElementById('dueDate').value = phtToday; 
            return alert(`Strict Validation Error: The selected date (${due}) is in the past.\n\nYou cannot bypass the date. It must be today or in the future according to Philippine Standard Time (${phtToday}).`);
        }
    } catch (e) {
        console.error("Date validation error:", e);
    }

    const isViewer = state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2;
    const isAdmin = isAnyAdmin(state.currentUser.email) && !isViewer;

    for (const item of state.cart) {
        if (state.borrowedSerials.has(item.serial)) return alert(`Serial ${item.serial} is currently PENDING or OUT.`);
    }
    
    const actionType = isAdmin ? "ISSUE" : "REQUEST";
    const msg = isAdmin ? `Proceed to create ${state.cart.length} items in 'For Release' list?` : `Submit request for ${state.cart.length} items?`;

    if (!await showConfirm(actionType, msg)) return;

    try {
        const batchID = await getNextGatePassID();
        
        const { data: { user } } = await supabase.auth.getUser();
        
        // ALWAYS start at Station 1 (Property), regardless of who requests it
        let initialStatus = "PENDING_PROPERTY";
        
        // Bulletproof detection: Check URL, Cart contents, and Project name
        const isPhilSysUrl = window.location.pathname.toLowerCase().includes('philsys');
        const hasPhilSysItems = state.cart.some(item => item.asset === 'Luggage Kit' || String(item.desc).toLowerCase().includes('[sn:'));
        const isPhilSysProject = proj.toLowerCase().includes('philsys');
        
        const requestDepartment = (isPhilSysUrl || hasPhilSysItems || isPhilSysProject) ? 'PhilSys' : 'PSA';
        
        const records = state.cart.map(item => ({
            unique_id: batchID,
            issuer_email: user.email,
            borrower, 
            guard_out: "TBD", // Handled by Station 4 Admin on Release
            destination: dest, 
            project: proj, 
            due_date: due,
            serial: item.serial, 
            property_no: item.property_no, 
            description: item.desc, 
            asset_no: item.asset,
            status: initialStatus, 
            department: requestDepartment, // <--- SAVES ACCURATE INDICATOR TO DB
            time_out: null, 
            time_return: null
        }));

        const { error } = await supabase.from('gate_passes').insert(records);
        if (error) throw error;

        // Unified success message
        const successMsg = `Request Submitted! ID: ${batchID} - Waiting for Property Approval.`;

        alert(successMsg);
        
        state.cart = []; 
        renderCart();
        
        if (isAdmin) document.getElementById('borrower').value = "";
        window.refreshTableData();
        
        document.querySelector('.nav-item-btn[data-target="view-approvals"]')?.click();
        
        // Always switch to Station 1 tab upon submission
        const tabEl = document.querySelector('#approvalTabs button[data-bs-target="#stn1Pane"]');
        if(tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();

    } catch(e) { alert(e.message); }
}

export async function approveBatch(batchId, currentStatus) {
    let nextStatus = '';
    let confirmMsg = '';
    let successMsg = '';
    
    const email = state.currentUser.email;
    if (currentStatus === 'PENDING_PROPERTY' && email !== ADMIN_ROLES.STATION_1) return alert("Only Property (Station 1) can approve this.");
    if (currentStatus === 'PENDING_INSPECTION' && email !== ADMIN_ROLES.STATION_2) return alert("Only Inspection (Station 2) can approve this.");
    if (currentStatus === 'PENDING_OIC' && email !== ADMIN_ROLES.STATION_3) return alert("Only OIC (Station 3) can approve this.");

    if (currentStatus === 'PENDING_PROPERTY') { nextStatus = 'PENDING_INSPECTION'; confirmMsg = `Move ${batchId} to Inspection?`; successMsg = "Moved to Inspection."; } 
    else if (currentStatus === 'PENDING_INSPECTION') { nextStatus = 'PENDING_OIC'; confirmMsg = `Move ${batchId} to OIC?`; successMsg = "Moved to OIC."; } 
    else if (currentStatus === 'PENDING_OIC') { nextStatus = 'RELEASING'; confirmMsg = `Move ${batchId} to For Release?`; successMsg = "Moved to For Release."; }

    if (!await showConfirm("Approve Request", confirmMsg)) return;

    try {
        const { data: batchData } = await supabase.from('gate_passes').select('issuer_email').eq('unique_id', batchId).eq('status', currentStatus);
        const issuerEmail = batchData && batchData.length > 0 ? batchData[0].issuer_email : null;

        const { error } = await supabase.from('gate_passes').update({ status: nextStatus }).eq('unique_id', batchId).eq('status', currentStatus);
        if (error) throw error;
        
        if (issuerEmail) {
            let statusText = nextStatus;
            if (nextStatus === 'PENDING_INSPECTION') statusText = 'Approved by Property (Station 1)';
            if (nextStatus === 'PENDING_OIC') statusText = 'Approved by Inspection (Station 2)';
            if (nextStatus === 'RELEASING') statusText = 'Approved by OIC (Station 3) - Ready for Release';

            let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + issuerEmail) || '[]');
            if (!localNotifs.some(n => n.batch_id === batchId && n.status === nextStatus)) {
                localNotifs.unshift({
                    id: Date.now().toString() + Math.random().toString(36).substring(2),
                    batch_id: batchId,
                    type: 'ACCEPTED',
                    status: nextStatus,
                    message: `Batch ${batchId}: ${statusText}`,
                    timestamp: new Date().toISOString()
                });
                localStorage.setItem('psa_notifications_' + issuerEmail, JSON.stringify(localNotifs));
            }
        }

        alert(successMsg);
        window.refreshTableData();
    } catch(e) { alert(e.message); }
}

export function confirmReleaseBatch(batchId) {
    const email = state.currentUser?.email;
    
    // Only Station 1 and Station 4 can even open the release modal
    if (email !== ADMIN_ROLES.STATION_4 && email !== ADMIN_ROLES.STATION_1) {
        return alert("Unauthorized. Only Admins can release items.");
    }

    // Verify Department Ownership Before Modaling
    const batchItems = state.releasingData.filter(i => i.unique_id === batchId);
    if (batchItems.length > 0) {
        const dept = batchItems[0].department || 'PSA';
        if (dept === 'PhilSys' && email !== ADMIN_ROLES.STATION_1) {
            return alert("Unauthorized: Only Admin1 (Station 1) can release PhilSys kits.");
        }
        if (dept !== 'PhilSys' && email !== ADMIN_ROLES.STATION_4) {
            return alert("Unauthorized: Only Admin (Station 4) can release standard PSA items.");
        }
    }
    
    document.getElementById('releaseGuardName').value = "";
    document.getElementById('releasePdf').value = "";
    state.tempReleaseBatchId = batchId;

    const modalEl = document.getElementById('releaseModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}

export async function handleReleaseSubmit() {
    const batchId = state.tempReleaseBatchId;
    if (!batchId) return alert("System Error: No batch selected.");

    const guardName = document.getElementById('releaseGuardName').value.trim();
    const pdfFile = document.getElementById('releasePdf').files[0];

    if (!guardName) return alert("Please enter the Guard Name.");
    if (!pdfFile) return alert("Please upload the signed gate pass PDF.");

    const email = state.currentUser?.email;

    const btn = document.getElementById('btnConfirmRelease');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> Uploading...`;

    try {
        // 1. Strict Server-Side Validation Check
        const { data: batchData } = await supabase.from('gate_passes').select('issuer_email, department').eq('unique_id', batchId).eq('status', 'RELEASING');
        
        if (!batchData || batchData.length === 0) {
            throw new Error("Batch not found or already released.");
        }

        const dept = batchData[0].department || 'PSA';
        if (dept === 'PhilSys' && email !== ADMIN_ROLES.STATION_1) {
            throw new Error("Unauthorized: Only Admin1 can release PhilSys kits.");
        }
        if (dept !== 'PhilSys' && email !== ADMIN_ROLES.STATION_4) {
            throw new Error("Unauthorized: Only Admin can release standard PSA items.");
        }

        const issuerEmail = batchData[0].issuer_email;

        // 2. Upload the Signed File
        const fileName = `${batchId}_SIGNED_${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage.from('psa_uploads').upload(`releases/${fileName}`, pdfFile);
        if (uploadError) throw new Error("File Upload Failed: " + uploadError.message);
        
        const { data: publicData } = supabase.storage.from('psa_uploads').getPublicUrl(`releases/${fileName}`);
        const pdfPublicUrl = publicData.publicUrl;

        // 3. Mark the Gate Pass Out
        const { error: updateError } = await supabase.from('gate_passes').update({
            status: 'OUT', 
            time_out: new Date(), 
            guard_out: guardName,
            release_pdf_url: pdfPublicUrl 
        }).eq('unique_id', batchId).eq('status', 'RELEASING');

        if (updateError) throw updateError;
        
        // 4. Send the Local Notification
        if (issuerEmail) {
            let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + issuerEmail) || '[]');
            if (!localNotifs.some(n => n.batch_id === batchId && n.status === 'OUT')) {
                localNotifs.unshift({
                    id: Date.now().toString() + Math.random().toString(36).substring(2),
                    batch_id: batchId,
                    type: 'ACCEPTED',
                    status: 'OUT',
                    message: `Batch ${batchId}: Released (Active). Please pick up your items.`,
                    timestamp: new Date().toISOString()
                });
                localStorage.setItem('psa_notifications_' + issuerEmail, JSON.stringify(localNotifs));
            }
        }

        alert("Release Confirmed! Signed PDF attached to Active Record.");
        
        const modalEl = document.getElementById('releaseModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if(modal) modal.hide();

        window.refreshTableData();
        
        document.querySelector('.nav-item-btn[data-target="view-records"]')?.click();
        const tabEl = document.querySelector('#recordsTabs button[data-bs-target="#activeRecordsTab"]');
        if (tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();

    } catch(e) { 
        alert(e.message); 
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

export async function rejectBatch(batchId, currentStatus) {
     if (state.currentUser && (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2)) return alert("Read-Only Access: Cannot reject batches.");
     if (!await showConfirm("Delete/Reject", `Are you sure you want to delete ${batchId}?`)) return;
     try {
        const { data: batchData } = await supabase.from('gate_passes').select('unique_id, issuer_email, description, serial').eq('unique_id', batchId).eq('status', currentStatus);
        const issuerEmail = batchData && batchData.length > 0 ? batchData[0].issuer_email : null;

        // Auto-restore any borrowed components back to original kits before deleting
        if (batchData && batchData.length > 0) {
            await restoreBorrowedKits(batchData);
        }

        const { error } = await supabase.from('gate_passes').delete().eq('unique_id', batchId).eq('status', currentStatus);
        if (error) throw error;
        
        if (issuerEmail && currentStatus !== 'ARCHIVED') {
            let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + issuerEmail) || '[]');
            localNotifs.unshift({
                id: Date.now().toString() + Math.random().toString(36).substring(2),
                batch_id: batchId,
                type: 'REJECTED',
                message: `Your request for Batch ${batchId} was denied or cancelled.`,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem('psa_notifications_' + issuerEmail, JSON.stringify(localNotifs));
        }

        alert(`Batch Deleted successfully.`);
        window.refreshTableData();
     } catch(e) { alert(e.message); }
}

export async function rejectRequest(id) {
    if (state.currentUser && (state.currentUser.email === ADMIN_ROLES.VIEWER || state.currentUser.email === ADMIN_ROLES.VIEWER2)) return alert("Read-Only Access: Cannot reject items.");
    if (!await showConfirm("Deny/Reject", "Deny/Reject this specific item?")) return;
    try {
        const { data: itemData } = await supabase.from('gate_passes').select('unique_id, issuer_email, description, serial').eq('id', id).single();
        const issuerEmail = itemData ? itemData.issuer_email : null;
        const batchId = itemData ? itemData.unique_id : 'Unknown';

        // Auto-restore borrowed components for this specific item
        if (itemData) {
            await restoreBorrowedKits([itemData]);
        }

        const { error } = await supabase.from('gate_passes').delete().eq('id', id);
        if (error) throw error;
        
        if (issuerEmail) {
            let localNotifs = JSON.parse(localStorage.getItem('psa_notifications_' + issuerEmail) || '[]');
            localNotifs.unshift({
                id: Date.now().toString() + Math.random().toString(36).substring(2),
                batch_id: batchId,
                type: 'REJECTED',
                message: `An item in your Batch ${batchId} was denied and removed.`,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem('psa_notifications_' + issuerEmail, JSON.stringify(localNotifs));
        }

        alert(`Item denied and removed. Notification sent.`);
        window.refreshTableData();
    } catch(e) { alert(e.message); }
}

export async function handleReturn() {
    const email = state.currentUser?.email;

    // Both Station 1 & 4 can initiate returns depending on the department
    if (email !== ADMIN_ROLES.STATION_4 && email !== ADMIN_ROLES.STATION_1) {
        return alert("Unauthorized. Only Admins can process returns.");
    }
    if (state.currentUser && (email === ADMIN_ROLES.VIEWER || email === ADMIN_ROLES.VIEWER2)) return alert("Read-Only Access.");
    
    const batchId = document.getElementById('returnBatchID').value.trim();
    const g = document.getElementById('guardIn').value.trim();
    const pdfFile = document.getElementById('returnPdf').files[0];
    
    if (!batchId || !g) return alert("Please fill in both the Gate Pass ID and Guard Name.");

    const { data, error } = await supabase.from('gate_passes').select('unique_id, description, serial, department').eq('unique_id', batchId).eq('status', 'OUT');

    if (error || !data || data.length === 0) {
        return alert("Batch ID not found or items are not currently marked as 'OUT'.");
    }

    // Verify Department Ownership Before Returning
    const dept = data[0].department || 'PSA';
    if (dept === 'PhilSys' && email !== ADMIN_ROLES.STATION_1) {
        return alert("Unauthorized: Only Admin1 (Station 1) can return PhilSys kits.");
    }
    if (dept !== 'PhilSys' && email !== ADMIN_ROLES.STATION_4) {
        return alert("Unauthorized: Only Admin (Station 4) can return standard PSA items.");
    }

    if (!await showConfirm("Batch Return", `Return all ${data.length} items for Batch ${batchId}?`)) return;

    const btn = document.getElementById('returnBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> Processing...`;

    try {
        let pdfPublicUrl = null;
        if (pdfFile) {
            const fileName = `${batchId}_RETURN_${Date.now()}.pdf`;
            const { error: uploadError } = await supabase.storage.from('psa_uploads').upload(`returns/${fileName}`, pdfFile);
            if (uploadError) throw new Error("File Upload Failed: " + uploadError.message);
            const { data: publicData } = supabase.storage.from('psa_uploads').getPublicUrl(`returns/${fileName}`);
            pdfPublicUrl = publicData.publicUrl;
        }

        const updatePayload = { status: 'RETURNED', guard_in: g, time_return: new Date().toISOString() };
        if (pdfPublicUrl) { updatePayload.return_receipt_url = pdfPublicUrl; }

        const { error: updateError } = await supabase.from('gate_passes').update(updatePayload).eq('unique_id', batchId).eq('status', 'OUT');
        if (updateError) throw updateError;
        
        // Auto-restore any borrowed components back to original kits
        await restoreBorrowedKits(data);

        alert(`Batch ${batchId} returned successfully!`);
        document.getElementById('returnBatchID').value = "";
        document.getElementById('guardIn').value = "";
        document.getElementById('returnPdf').value = ""; 
        window.refreshTableData();
        
    } catch (e) {
        alert("Return failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// CLIENT-SIDE PDF PARSER & AUTO-DETECT LOGIC
// =========================================================================

export async function autoDetectFromPdf(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    try {
        if (!window.pdfjsLib) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                script.onload = () => {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ') + ' ';
        }

        const normalizedText = fullText.replace(/\s+/g, ' ');
        tempRawPdfText = normalizedText; 

        const gpMatch = normalizedText.match(/Gate Pass No[:\s]*([\w-]+)/i);
        if (gpMatch && document.getElementById('histBatchId')) {
            document.getElementById('histBatchId').value = gpMatch[1].trim();
        }

        const dateMatch = normalizedText.match(/Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (dateMatch && document.getElementById('histDateOut')) {
            const parts = dateMatch[1].split('/');
            if(parts.length === 3) {
                const d = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`);
                if(!isNaN(d)) document.getElementById('histDateOut').value = d.toISOString().split('T')[0];
            }
        }

        const borrowerMatch = normalizedText.match(/allow\s+(?:Mr\.|Ms\.|Mrs\.)?\s*(.*?)\s+to bring out/i);
        if (borrowerMatch && document.getElementById('histBorrower')) {
            document.getElementById('histBorrower').value = borrowerMatch[1].trim();
        }

        const destMatch = normalizedText.match(/to\s+(.*?)\s+for the purpose/i);
        if (destMatch) {
            tempDetectedDest = destMatch[1].trim();
            if (document.getElementById('histDestination')) document.getElementById('histDestination').value = tempDetectedDest;
        }

        const projMatch = normalizedText.match(/for the purpose of\s+(.*?)\./i);
        if (projMatch) {
            tempDetectedProj = projMatch[1].trim();
            if (document.getElementById('histProject')) document.getElementById('histProject').value = tempDetectedProj;
        }

    } catch (e) {
        console.error("PDF Scan Error:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const pdfInput = document.getElementById('histPdf');
        if (pdfInput) pdfInput.addEventListener('change', autoDetectFromPdf);
    }, 1500);
});

// =========================================================================
// SIMPLIFIED HISTORICAL UPLOAD (PDF ARCHIVING)
// =========================================================================

export async function handleHistoricalImport() {
    if (state.currentUser.email !== ADMIN_ROLES.STATION_4 && state.currentUser.email !== ADMIN_ROLES.STATION_1) {
         return alert("Unauthorized. Only Admins can upload archives.");
    }

    const batchId = document.getElementById('histBatchId').value.trim();
    const pdfFile = document.getElementById('histPdf').files[0];

    if (!batchId || !pdfFile) {
        return alert("Please provide the Gate Pass ID and upload the PDF.");
    }

    const btn = document.getElementById('btnSubmitHistorical');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> Uploading...`;

    try {
        const { data: existingData, error: checkError } = await supabase
            .from('gate_passes')
            .select('unique_id')
            .eq('unique_id', batchId)
            .limit(1);

        if (checkError) throw new Error("Database verification failed: " + checkError.message);
        
        if (existingData && existingData.length > 0) {
            throw new Error(`Gate Pass ID "${batchId}" already exists in the system. Please use a unique ID.`);
        }

        const safeBatchId = batchId.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `ARCHIVE_${safeBatchId}_${Date.now()}.pdf`;

        const { error: uploadError } = await supabase.storage.from('psa_uploads').upload(`returns/${fileName}`, pdfFile);
        if (uploadError) throw new Error("File Upload Failed: " + uploadError.message);

        const { data: publicData } = supabase.storage.from('psa_uploads').getPublicUrl(`returns/${fileName}`);
        const pdfPublicUrl = publicData.publicUrl;

        const uniqueSerialPlaceholder = `ARCHIVE-${safeBatchId}-${Date.now()}`;
        
        const requestDepartment = window.location.pathname.includes('philsys') ? 'PhilSys' : 'PSA';

        const { error: insertError } = await supabase.from('gate_passes').insert([{
            unique_id: batchId,
            issuer_email: state.currentUser.email,
            borrower: "ARCHIVED SCANNED DOCUMENT",
            guard_out: "N/A",
            guard_in: "N/A",
            destination: "Historical Archive",
            project: "N/A",
            due_date: new Date().toISOString().split('T')[0], 
            serial: uniqueSerialPlaceholder, 
            property_no: 'N/A',
            description: "Scanned PDF Attachment",
            asset_no: 'N/A',
            status: 'ARCHIVED',
            department: requestDepartment, 
            time_out: new Date().toISOString(),
            time_return: new Date().toISOString(),
            return_receipt_url: pdfPublicUrl
        }]);

        if (insertError) throw insertError;

        alert(`Scanned Gate Pass ${batchId} archived successfully!`);

        document.getElementById('histForm').reset();
        const modalEl = document.getElementById('importHistoryModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
        }

        window.refreshTableData();
    } catch (e) {
        alert("Upload failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// INVENTORY BULK IMPORT LOGIC (EXCEL)
// =========================================================================

export async function processImportFile() {
    const fileInput = document.getElementById('inventoryFile');
    const file = fileInput ? fileInput.files[0] : null;
    if (!file) return alert("Select an Excel file first.");
    
    const btn = document.getElementById('processImportBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i>Processing...';
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = window.XLSX.read(data, { type: 'array' });
            const json = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            let rawData = json.map(row => ({
                serial: String(row['serial_no'] || row['Serial'] || row['serial'] || "").trim(),
                description: row['description'] || row['Description'],
                asset_no: String(row['asset_no'] || row['Asset'] || row['Asset No'] || row['asset'] || ""),
                property_no: String(row['property_no'] || row['Property'] || row['Property No'] || row['property'] || "")
            })).filter(x => x.serial);
            
            const uniqueMap = new Map(); 
            rawData.forEach(item => { uniqueMap.set(item.serial, item); });
            state.bulkImportData = Array.from(uniqueMap.values());
            
            const tbody = document.getElementById('importBody'); 
            if (tbody) {
                tbody.innerHTML = "";
                state.bulkImportData.slice(0, 5).forEach(d => { 
                    tbody.innerHTML += `<tr><td>${d.serial}</td><td>${d.property_no || '-'}</td><td>${d.description || '-'}</td><td>${d.asset_no || '-'}</td></tr>`; 
                });
                if (state.bulkImportData.length > 5) {
                    tbody.innerHTML += `<tr><td colspan="4" class="text-center text-muted small py-2 bg-light">...and ${state.bulkImportData.length - 5} more items</td></tr>`;
                }
            }
            
            const previewEl = document.getElementById('importPreview');
            const saveBtn = document.getElementById('saveBulkBtn');
            if (previewEl) previewEl.style.display = 'block';
            if (saveBtn) saveBtn.style.display = 'block';
            
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa fa-magnifying-glass me-2"></i> PREVIEW EXCEL DATA';
            }
        } catch (err) {
            alert("Excel Error: " + err.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa fa-magnifying-glass me-2"></i> PREVIEW EXCEL DATA';
            }
        }
    };
    reader.readAsArrayBuffer(file);
}

export async function saveBulkImport() {
    if(!state.bulkImportData || state.bulkImportData.length === 0) return;
    if(!await showConfirm("Import", `Save ${state.bulkImportData.length} items to Master Inventory?`)) return;
    
    const CHUNK_SIZE = 1000;
    const btn = document.getElementById('saveBulkBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i> Importing...';

    try {
        for (let i = 0; i < state.bulkImportData.length; i += CHUNK_SIZE) {
            const chunk = state.bulkImportData.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from('inventory').upsert(chunk, { onConflict: 'serial' });
            
            if(error) {
                throw new Error(`Batch ${Math.floor(i/CHUNK_SIZE) + 1} failed: ${error.message}`);
            }
        }
        
        alert("Inventory imported successfully!"); 
        state.bulkImportData = []; 
        const previewEl = document.getElementById('importPreview');
        if (previewEl) previewEl.style.display = 'none';
        btn.style.display = 'none';
        
        const fileInput = document.getElementById('inventoryFile');
        if (fileInput) fileInput.value = "";
        
        if(window.loadInventoryStats) window.loadInventoryStats();
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnProcess = document.getElementById('processImportBtn');
    if (btnProcess) btnProcess.addEventListener('click', processImportFile);

    const btnSave = document.getElementById('saveBulkBtn');
    if (btnSave) btnSave.addEventListener('click', saveBulkImport);
});