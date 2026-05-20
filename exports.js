// PDF & Excel Export Logic
import { state } from './state.js';
import { canManageFiles } from './config.js';
import { showConfirm } from './utils.js';
import { supabase } from './config.js';

/**
 * PHIL-SYS KIT EXPANDER
 * Dynamically detects PhilSys luggage kits and splits them into individual rows
 * for all PDF and Excel exports. This triggers only for PhilSys-formatted strings.
 */
function expandPhilSysItems(items) {
    let expanded = [];
    items.forEach(item => {
        const desc = item.description || "";
        // Check if this is a PhilSys Kit format
        if (desc.includes(' | ') && desc.includes('[SN:')) {
            const components = desc.split(' | ');
            
            // Check if there is already a parent item component (one without an [SN: ...] block)
            const hasMainKitRow = components.some(comp => !comp.match(/(.*?)\[SN:\s*(.*?)\]/));
            
            // If there's no explicitly defined parent row in the string, forcefully add the Luggage Kit row
            if (!hasMainKitRow) {
                expanded.push({
                    ...item,
                    description: "PhilSys Luggage Kit",
                    serial: item.serial || 'N/A',
                    property_no: 'N/A',
                    asset_no: 'N/A'
                });
            }

            components.forEach(comp => {
                const match = comp.match(/(.*?)\[SN:\s*(.*?)\]/);
                if (match) {
                    expanded.push({
                        ...item,
                        description: match[1].trim(),
                        serial: match[2].trim(),
                        property_no: 'N/A', // Set to N/A for kit parts
                        asset_no: 'N/A'     // Set to N/A for kit parts
                    });
                } else {
                    // For the existing main kit row (if manually provided in the string)
                    expanded.push({ 
                        ...item, 
                        description: comp.trim(),
                        serial: item.serial || 'N/A',
                        property_no: 'N/A', // Set to N/A for main kit
                        asset_no: 'N/A'     // Set to N/A for main kit
                    });
                }
            });
        } else {
            expanded.push(item);
        }
    });
    return expanded;
}

function getSelectedItems() {
    const activeViewId = document.querySelector('.app-view.active-view')?.id;
    let containerId = '';
    let sourceData = [];

    if (activeViewId === 'view-approvals') {
        const activeTab = document.querySelector('#approvalTabs .nav-link.active');
        const targetId = activeTab ? activeTab.getAttribute('data-bs-target') : '';

        if (targetId === '#stn1Pane') {
            state.currentExportContext = 'pending_property';
            containerId = 'station1TableBody';
            sourceData = state.station1Data;
        } else if (targetId === '#stn2Pane') {
            state.currentExportContext = 'pending_inspection';
            containerId = 'station2TableBody';
            sourceData = state.station2Data;
        } else if (targetId === '#stn3Pane') {
            state.currentExportContext = 'pending_oic';
            containerId = 'station3TableBody';
            sourceData = state.station3Data;
        } else {
            state.currentExportContext = 'releasing';
            containerId = 'releasingTableBody';
            sourceData = state.releasingData;
        }
    } else {
        state.currentExportContext = document.querySelector('#recordsTabs .nav-link.active')?.getAttribute('data-context') || 'active';
        containerId = state.currentExportContext === 'active' ? 'activeTableBody' : 'historyTableBody';
        sourceData = state.currentExportContext === 'active' ? state.activeData : state.historyData;
    }

    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const checkedBoxes = container.querySelectorAll('.export-check:checked');
    const checkedItemBoxes = container.querySelectorAll('.export-item-check:checked');
    if (!checkedBoxes.length && !checkedItemBoxes.length) { alert("Select at least one batch or serial number from the table."); return []; }
    
    const selectedBatchIds = Array.from(checkedBoxes).map(cb => cb.value);
    const selectedItemIds = Array.from(checkedItemBoxes).map(cb => cb.value);
    const filteredItems = sourceData.filter(item => selectedBatchIds.includes(item.unique_id) || selectedItemIds.includes(String(item.id)));
    
    return filteredItems.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function isOwnedByCurrentUser(item) {
    const user = state.currentUser || {};
    const email = normalize(user.email);
    const names = new Set([
        normalize(state.currentUserName),
        normalize(user.name),
        normalize(user.user_metadata?.name),
        normalize(user.user_metadata?.full_name)
    ].filter(Boolean));

    return normalize(item.issuer_email) === email || names.has(normalize(item.borrower));
}

function canExportItems(items) {
    if (canManageFiles(state.currentUser)) return true;
    if (!items.length) return false;
    return items.every(item => item.status === 'OUT' && isOwnedByCurrentUser(item));
}

function requireExportPermission(items) {
    if (canExportItems(items)) return true;
    alert("You can only export your own approved active gate pass.");
    return false;
}

function updateExportModalOptions() {
    const gatePassBtn = document.getElementById('btnExportGatePass');
    if (gatePassBtn) gatePassBtn.style.display = canManageFiles(state.currentUser) ? '' : 'none';
}

async function getStationApproverNames() {
    const defaults = {
        property: 'JENOR B. BLAS',
        inspection: 'MARY ANNE G. BASILIO',
        oic: 'MARICEL M. CARAGAN'
    };

    try {
        const { data, error } = await supabase
            .from('users')
            .select('name, department, role')
            .eq('role', 'admin')
            .in('department', ['Property', 'Inspection', 'OIC']);

        if (error || !data) return defaults;

        const byDept = new Map(data.map(user => [String(user.department || '').toLowerCase(), user.name]));
        return {
            property: String(byDept.get('property') || defaults.property).toUpperCase(),
            inspection: String(byDept.get('inspection') || defaults.inspection).toUpperCase(),
            oic: String(byDept.get('oic') || defaults.oic).toUpperCase()
        };
    } catch (error) {
        return defaults;
    }
}

export function openUnifiedExportModal() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    state.tempExportItems = null;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) return alert("Error: Multiple borrowers detected. Please select items for one person only.");
    const gatePasses = new Set(items.map(i => i.unique_id));
    if (!canManageFiles(state.currentUser) && gatePasses.size > 1) return alert("Please select serial numbers from one gate pass only.");

    const titleEl = document.getElementById('exportModalTitle');
    if(titleEl) titleEl.innerText = `Selected: ${items.length} Items`;
    updateExportModalOptions();

    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) bootstrap.Modal.getOrCreateInstance(exportModalEl).show();
}

export function triggerExportModal(batchId, status) {
    let sourceData = [];
    if (status === 'PENDING_PROPERTY') sourceData = state.station1Data;
    else if (status === 'PENDING_INSPECTION') sourceData = state.station2Data;
    else if (status === 'PENDING_OIC') sourceData = state.station3Data;
    else if (status === 'RELEASING') sourceData = state.releasingData;

    const items = sourceData.filter(i => i.unique_id === batchId);
    if (items.length === 0) return alert("Items not found.");
    items.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));

    state.tempExportItems = items;
    state.currentExportContext = status.toLowerCase(); 
    document.getElementById('exportModalTitle').innerText = `Exporting Batch: ${batchId}`;
    updateExportModalOptions();
    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) bootstrap.Modal.getOrCreateInstance(exportModalEl).show();
}

// --- EXCEL EXPORT ---
export async function exportExcel() {
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (!rawItems.length) return;
    if (!requireExportPermission(rawItems)) return;

    const items = expandPhilSysItems(rawItems);
    const borrowerName = items[0].borrower || "Unknown";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Excel", `Generate Excel for ${borrowerName}?`)) return;

    const exportData = items.map(item => ({
        "Gate Pass ID": item.unique_id,
        "Borrower": item.borrower,
        "Description": item.description,
        "Serial No.": item.serial,
        "Property No.": item.property_no || '',
        "Asset Tag": item.asset_no || '',
        "Destination": item.destination,
        "Project": item.project || '',
        "Status": item.status,
        "Time Out": item.time_out ? new Date(item.time_out).toLocaleString() : ''
    }));
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logs");
    XLSX.writeFile(wb, `PSA_Logs_${Date.now()}.xlsx`);
}

// --- GATE PASS PDF ---
export async function exportGatePass() {
    if (!canManageFiles(state.currentUser)) return alert("Gate Pass PDF export is only available to admins.");
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;
    if (!requireExportPermission(rawItems)) return;

    const items = expandPhilSysItems(rawItems);
    const borrowerName = items[0].borrower || "Unknown";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Gate Pass", `Generate Gate Pass for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ compress: true });
    const firstItem = items[0];
    const gatePassNo = firstItem.unique_id.replace("PSA-", ""); 
    const approvers = await getStationApproverNames();

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

    try {
        doc.addImage("PSA.jpg", "JPEG", 15, 5, 25, 25, "psa", "FAST");
        doc.addImage("BP.jpg", "JPEG", 170, 5, 25, 25, "bp", "FAST");
    } catch(e) {}

    doc.setTextColor(0, 0, 0); 
    doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text("REPUBLIC OF THE PHILIPPINES", 105, 15, { align: "center" });
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("PHILIPPINE STATISTICS AUTHORITY", 105, 20, { align: "center" });
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("NCR - Provincial Statistical Office V", 105, 25, { align: "center" });
    doc.text("Las Piñas Muntinlupa Parañaque Pasay", 105, 30, { align: "center" });

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
    doc.setFont("helvetica", "normal"); doc.text("Date: ", 15, 45);
    doc.setFont("helvetica", "bold"); const dateW = doc.getTextWidth("Date: ");
    doc.text(dateStr, 15 + dateW, 45); doc.line(15 + dateW, 46, 15 + dateW + doc.getTextWidth(dateStr), 46);

    doc.text("Gate Pass No.:", 145, 45, { align: "right" });
    doc.rect(147, 40, 48, 8); doc.text(gatePassNo, 171, 45.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.text("Annex A", 195, 53, { align: 'right' }); 

    doc.setFont("helvetica", "bold"); doc.text("TO THE GUARD ON DUTY:", 15, 60);

    // Format due date
    const dueDateStr = firstItem.due_date
        ? new Date(firstItem.due_date).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })
        : '________________';

    // Build segments: alternating normal/bold inline text
    const segments = [
        { text: "Please allow ", bold: false },
        { text: firstItem.borrower.toUpperCase(), bold: true },
        { text: " to bring out property / equipment listed below from ", bold: false },
        { text: "PSA NCR PSO V - FIELD OFFICE", bold: true },
        { text: " to ", bold: false },
        { text: firstItem.destination || "________________", bold: true },
        { text: " for the purpose of ", bold: false },
        { text: firstItem.project || "________________", bold: true },
        { text: ", until ", bold: false },
        { text: dueDateStr, bold: true },
        { text: ".", bold: false },
    ];

    // Inline flow renderer — wraps at right margin, draws ONE continuous underline per bold segment
    const LEFT = 15, RIGHT = 195, LINE_H = 7;
    let currentY = 70, cx = LEFT;
    doc.setFontSize(10);

    segments.forEach(seg => {
        doc.setFont("helvetica", seg.bold ? "bold" : "normal");

        // Split into tokens keeping spaces so spacing is preserved
        const words = seg.text.split(/(?<=\s)|(?=\s)/);

        // Track underline spans: each time we wrap, close the current span and start a new one
        let spanStartX = cx;
        let spanY = currentY;

        words.forEach(word => {
            const ww = doc.getTextWidth(word);
            const isSpace = word.trim() === '';

            if (!isSpace && cx + ww > RIGHT) {
                // Close underline span on current line before wrapping
                if (seg.bold && cx > spanStartX) {
                    doc.line(spanStartX, spanY + 1, cx, spanY + 1);
                }
                currentY += LINE_H;
                cx = LEFT;
                spanStartX = cx;
                spanY = currentY;
            }

            doc.setFont("helvetica", seg.bold ? "bold" : "normal");
            doc.text(word, cx, currentY);
            cx += ww;
        });

        // Close the final underline span for this segment
        if (seg.bold && cx > spanStartX) {
            doc.line(spanStartX, spanY + 1, cx, spanY + 1);
        }
    });

    currentY += LINE_H + 3;

    const formatTime = (t) => t ? new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}) : '';
    const tableBody = items.map(i => [i.description, i.serial, i.property_no || '', i.asset_no || '', i.destination, formatTime(i.time_out), i.time_return ? formatTime(i.time_return) : '']);

    doc.autoTable({
        startY: currentY + 12,
        head: [['Description of\nLaptop/Equipment', 'Serial\nNumber', 'Property\nNumber', 'Asset\nTag No.', 'Destination', 'Time\nOut', 'Time\nReturned']],
        body: tableBody, theme: 'grid', 
        margin: { bottom: 40 }, 
        styles: { textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontSize: 9, valign: 'middle', halign: 'center' },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'left', cellWidth: 50 } },
        didDrawPage: function() { stampFooter(); }
    });

    let finalY = doc.lastAutoTable.finalY + 10;
    if (finalY + 150 > doc.internal.pageSize.height) { doc.addPage(); finalY = 20; }
    doc.text("Remarks:", 15, finalY); finalY += 6; doc.line(15, finalY, 195, finalY); finalY += 8; doc.line(15, finalY, 195, finalY); finalY += 10;

    const drawSig = (name, title, x, y) => {
        doc.setFont("helvetica", "bold"); doc.text(name, x, y, { align: "center" });
        const w = Math.max(doc.getTextWidth(name) + 10, 60); doc.line(x - (w/2), y + 1.5, x + (w/2), y + 1.5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(doc.splitTextToSize(title, w + 30), x, y + 6, { align: "center" });
    };

    // Requested by — centered, above Checked / Inspected by
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Requested by:", 105, finalY, { align: "center" });
    finalY += 15;
    drawSig(borrowerName.toUpperCase(), "Signature over Printed Name", 105, finalY);
    finalY += 25;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Checked / Inspected by:", 15, finalY); finalY += 15;

    drawSig(approvers.property, "Property and Supply Officer", 60, finalY);
    drawSig(approvers.inspection, "Inspection Officer", 150, finalY);
    finalY += 25; doc.text("Approved by:", 105, finalY - 12, { align: "center" });
    drawSig(approvers.oic, "Supervising Statistical Specialist\nOfficer-in-Charge, PSA NCR PSO V", 105, finalY);

    // Guard on Duty — push to new page if it won't fit above the footer
    finalY += 30;
    const pageHeight = doc.internal.pageSize.height;
    if (finalY + 20 > pageHeight - 30) { doc.addPage(); stampFooter(); finalY = 25; }
    drawSig("", "Guard on Duty", 105, finalY);

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); stampFooter(); }
    doc.save(`GatePass_${borrowerName}_${firstItem.unique_id}.pdf`);
}

// --- ACKNOWLEDGEMENT RECEIPT ---
export async function exportAckReceipt() {
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;
    if (!requireExportPermission(rawItems)) return;

    const items = expandPhilSysItems(rawItems);
    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) { return alert("Error: Multiple borrowers selected."); }
    
    const borrowerName = items[0].borrower || "Unknown";
    const projectName = items[0].project || "N/A";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Receipt", `Generate Acknowledgement Receipt for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4', compress: true });

    // Landscape dimensions: 297 x 210mm
    const PW = 297, PH = 210;
    const LM = 15, RM = PW - 15, TW = RM - LM; // left margin, right margin, text width
    const MID = PW / 2;

    const addFooter = (docInstance) => {
        const footerY = PH - 20;
        docInstance.setLineWidth(0.5); docInstance.line(LM, footerY - 5, RM, footerY - 5);
        docInstance.setFontSize(8); docInstance.setFont("helvetica", "normal"); docInstance.setTextColor(0, 0, 0);
        docInstance.text("3rd Floor STWLPC Building, 335-338 Sen. Gil Puyat Avenue (Buendia)", MID, footerY, { align: "center" });
        docInstance.text("Barangay 49 Zone 7, Pasay City Philippines 1300", MID, footerY + 4, { align: "center" });
        docInstance.text("Telephone (632) 833-8284 • Telefax (632) 834-0051", MID, footerY + 8, { align: "center" });
        docInstance.text("Email Address: ncr5@psa.gov.ph, Website: www.psa.gov.ph", MID, footerY + 12, { align: "center" });
    };

    // Justified text renderer
    const drawJustified = (text, x, y, maxWidth, lineHeight) => {
        const lines = doc.splitTextToSize(text, maxWidth);
        lines.forEach((line, idx) => {
            const isLast = idx === lines.length - 1;
            if (isLast) {
                // Last line: left-align
                doc.text(line, x, y);
            } else {
                const words = line.trim().split(/\s+/);
                if (words.length <= 1) { doc.text(line, x, y); }
                else {
                    const totalWordW = words.reduce((s, w) => s + doc.getTextWidth(w), 0);
                    const gap = (maxWidth - totalWordW) / (words.length - 1);
                    let cx = x;
                    words.forEach(word => { doc.text(word, cx, y); cx += doc.getTextWidth(word) + gap; });
                }
            }
            y += lineHeight;
        });
        return y;
    };

    try {
        doc.addImage("PSA.jpg", "JPEG", 15, 5, 25, 25, "psa", "FAST");
        doc.addImage("BP.jpg", "JPEG", PW - 40, 5, 25, 25, "bp", "FAST");
    } catch(e) {}

    doc.setTextColor(0, 0, 0); 
    doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text("REPUBLIC OF THE PHILIPPINES", MID, 15, { align: "center" });
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("PHILIPPINE STATISTICS AUTHORITY", MID, 20, { align: "center" });
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("NCR - Provincial Statistical Office V", MID, 25, { align: "center" });
    doc.text("Las Piñas Muntinlupa Parañaque Pasay", MID, 30, { align: "center" });

    let currentY = 40;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const refNo = items[0].unique_id || `PSA-${Math.floor(1000 + Math.random() * 9000)}`; 
    doc.text(`Ref No.: ${refNo}`, LM, currentY);
    
    currentY += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Acknowledgment Form", MID, currentY, { align: "center" }); currentY += 10;

    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const text1 = "All hired field-based personnel for the specified project listed below acknowledges the receipt of the following: a) tablet, b) accessories compatible case and adapter, and c) powerbank.";
    const text2 = "All personnel who were given these devices will be held liable for any acts of negligence and malicious intent resulting to the loss or damage of these tablets. Should there be a lost/damaged tablet, the responsible personnel should immediately inform the incident to their immediate supervisor. Upon the evaluation of the Philippine Statistics Authority (PSA) Provincial Statistical Office (PSO) Chief Statistical Specialist (CSS), an anticipated cost required to repair the damage in the tablet must be shouldered by the liable personnel. In the event that the tablet is lost, a salary deduction equivalent to the market value of the comparable device must be charged against the responsible personnel. Due to this, it is crucial to exercise caution and care to the equipment/device entrusted by the PSA to every field-based personnel for the successful and secure operationalization.";
    const text3 = "Affixing your name and signature in the next page signifies that you hereby acknowledge the receipt of the above-listed devices/items under your name and fully understand the responsibilities attached to these.";
    
    currentY = drawJustified(text1, LM, currentY, TW, 5); currentY += 4;
    currentY = drawJustified(text2, LM, currentY, TW, 5); currentY += 4;
    currentY = drawJustified(text3, LM, currentY, TW, 5); currentY += 8;
    
    doc.setFont("helvetica", "bold"); doc.text(`Project: ${projectName}`, LM, currentY); doc.text("Instructor: ___________________________", LM, currentY + 7);
    currentY += 15;

    const tableData = items.map((item, index) => {
        const desc = (item.description || "").toLowerCase();
        const brand = desc.includes('samsung') ? "Samsung" : (item.description || "").split(' ')[0];
        return [index + 1, "", brand, item.serial, item.asset_no || "", "", "", ""];
    });

    const BOX_SIZE = 3.5; // mm — size of each checkbox square
    const ACK_LINE_H = BOX_SIZE + 2.5;

    // Per-item label sets based on device type
    const LABELS_TABLET   = ["Powerbank", "Type C Cable", "Adapter", "Compatible Case"];
    const LABELS_LAPTOP   = ["Power Cable", "Keyboard", "Mouse", "HDMI"];
    const LABELS_DESKTOP  = ["Power Cable", "Keyboard", "Mouse", "HDMI"];

    const getLabelsForItem = (item) => {
        const d = (item.description || "").toLowerCase();
        if (d.includes('laptop')) return LABELS_LAPTOP;
        if (d.includes('desktop') || d.includes('cpu') || d.includes('computer')) return LABELS_DESKTOP;
        return LABELS_TABLET; // default: tablets and everything else
    };

    // Pre-compute labels per row so didDrawCell can look them up by index
    const rowLabels = items.map(item => getLabelsForItem(item));
    const maxLabels = Math.max(...rowLabels.map(l => l.length));
    const ACK_TOTAL_H = ACK_LINE_H * (maxLabels - 1) + BOX_SIZE;
    const drawnAckRows = new Set(); // prevent double-draw on page breaks

    doc.autoTable({
        startY: currentY,
        head: [["No.", "Name of Hired\nBased Personnel", "Tablet\nBrand", "Serial Number", "Asset Tag\nNo.", "With Powerbank\nand/or Accessories", "Signature", "Date of\nAcknowledgement"]],
        body: tableData, theme: 'grid',
        margin: { left: LM, right: LM, bottom: 38 },
        rowPageBreak: 'avoid',
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 8 },
        styles: { textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontSize: 8, valign: 'middle', minCellHeight: ACK_TOTAL_H + 8 },
        // Landscape: 267mm usable — distribute generously to Name column
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 80 }, 2: { cellWidth: 22 }, 3: { cellWidth: 38 }, 4: { cellWidth: 20, halign: 'center' }, 5: { cellWidth: 35, fontSize: 7 }, 6: { cellWidth: 32 }, 7: { cellWidth: 30 } },
        didDrawPage: function (data) { addFooter(doc); },
        didDrawCell: function (data) {
            if (data.section !== 'body' || data.column.index !== 5) return;
            if (drawnAckRows.has(data.row.index)) return;
            drawnAckRows.add(data.row.index);

            const labels = rowLabels[data.row.index] || LABELS_TABLET;
            const totalH = ACK_LINE_H * (labels.length - 1) + BOX_SIZE;
            const x = data.cell.x + 2;
            const rawStartY = data.cell.y + (data.cell.height - totalH) / 2;
            const safeStartY = Math.max(rawStartY, data.cell.y + 2);

            doc.setDrawColor(0); doc.setLineWidth(0.3);
            doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
            labels.forEach((label, i) => {
                const y = safeStartY + i * ACK_LINE_H;
                doc.rect(x, y, BOX_SIZE, BOX_SIZE);
                doc.text(label, x + BOX_SIZE + 1, y + BOX_SIZE - 0.5);
            });
        }
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        // Place page number just above the footer separator line (footerY - 5 is the line, so sit at footerY - 9)
        const pageHeight = doc.internal.pageSize.height;
        doc.text(`Page ${i} of ${totalPages}`, doc.internal.pageSize.width - 15, pageHeight - 26, { align: 'right' });
    }
    doc.save(`AcknowledgementReceipt_${projectName}_${new Date().toISOString().split('T')[0]}.pdf`);
}

// --- TRANSMITTAL FORM ---
export async function exportTransmittal() {
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;
    if (!requireExportPermission(rawItems)) return;

    const items = expandPhilSysItems(rawItems);
    const borrowerName = items[0].borrower || "Unknown";
    const projectName = items[0].project || "PSA PROJECT";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Transmittal", `Generate Transmittal for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ compress: true });

    const stampFooter = () => {
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const footerY = pageHeight - 20;
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
        doc.text("3rd Floor STWLPC Building, 335-338 Sen. Gil Puyat Avenue (Buendia), Barangay 49 Zone 7, Pasay City", pageWidth / 2, footerY, { align: "center" });
    };

    try {
        doc.addImage("PSA.jpg", "JPEG", 15, 5, 25, 25, "psa", "FAST");
        doc.addImage("BP.jpg", "JPEG", 170, 5, 25, 25, "bp", "FAST");
    } catch(e) {}

    doc.setFontSize(11); doc.text("REPUBLIC OF THE PHILIPPINES", 105, 15, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.text("PHILIPPINE STATISTICS AUTHORITY", 105, 20, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.text("NCR - Provincial Statistical Office V", 105, 25, { align: "center" });

    let currentY = 40; doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(projectName.toUpperCase(), 105, currentY, { align: "center" }); currentY += 10;
    doc.setFontSize(14); doc.text("TRANSMITTAL / RECEIPT FORM", 105, currentY, { align: "center" }); currentY += 15;
    
    // --- SUMMARY COUNT TABLE ---
    // Accessories list mirrors the checkboxes in the detail table
    const ACCESSORIES = ["Powerbank", "Type C Cable", "Adapter", "Compatible Case"];
    const summaryCounts = {};
    items.forEach(item => {
        const d = (item.description || "Unknown").trim();
        let b = d;
        if (d.toLowerCase().includes('tablet')) b = "Tablet";
        else if (d.toLowerCase().includes('laptop')) b = "Laptop";
        summaryCounts[b] = (summaryCounts[b] || 0) + 1;
    });
    const summaryBody = [];
    Object.entries(summaryCounts).forEach(([n, c]) => {
        summaryBody.push([n, String(c)]);                          // auto count for the item
        ACCESSORIES.forEach(acc => summaryBody.push([acc, ""]));   // blank — filled by hand
    });

    // Column widths must match the detail table exactly: total = 170mm
    // Detail: 10 + 45 + 30 + 25 + 15 + 45 = 170mm
    // Summary: item col = 155mm, count col = 15mm → total = 170mm
    doc.autoTable({
        startY: currentY, head: [['TOTAL', '']], body: summaryBody, theme: 'plain',
        margin: { left: 14, right: 14, bottom: 40 },
        styles: { fontSize: 9, textColor: [0,0,0], lineColor: [0,0,0], lineWidth: 0.3, cellPadding: 1 },
        headStyles: { fillColor: [255,255,255], lineWidth: 0.3, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 155 }, 1: { cellWidth: 15, halign: 'center' } },
        didDrawPage: function() { stampFooter(); }
    });
    currentY = doc.lastAutoTable.finalY + 10;

    // --- DETAILED ITEM TABLE ---
    const tableBody = items.map((it, idx) => {
        return [idx + 1, it.description || '', it.serial || '', it.asset_no || 'N/A', "1", ""];
    });

    const TX_BOX = 3.5; // mm — checkbox square size
    const TX_LABELS = ["Powerbank", "Type C Cable", "Adapter", "Compatible Case"];
    const TX_LINE_H = TX_BOX + 3.5;
    const TX_TOTAL_H = TX_LINE_H * (TX_LABELS.length - 1) + TX_BOX;
    const drawnTxRows = new Set(); // prevent double-draw on page breaks

    doc.autoTable({
        startY: currentY,
        head: [['No.', 'ITEM NAME', 'SERIAL No.', 'ASSET TAG No.', 'UNIT', 'ACCESSORIES']],
        body: tableBody, theme: 'plain', 
        margin: { left: 14, right: 14, bottom: 45 }, 
        rowPageBreak: 'avoid',
        styles: { fontSize: 9, lineColor: [0,0,0], lineWidth: 0.3, valign: 'middle', cellPadding: 3, minCellHeight: TX_TOTAL_H + 8 },
        headStyles: { fillColor: [255,255,255], lineWidth: 0.3, fontStyle: 'bold', halign: 'center', minCellHeight: 10 },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 45 }, 2: { cellWidth: 30 }, 3: { cellWidth: 25, halign: 'center' }, 4: { cellWidth: 15, halign: 'center' }, 5: { cellWidth: 45 } },
        didDrawPage: function() { stampFooter(); },
        didDrawCell: function (data) {
            if (data.section !== 'body' || data.column.index !== 5) return;
            if (drawnTxRows.has(data.row.index)) return; // skip duplicate on page break
            drawnTxRows.add(data.row.index);

            const x = data.cell.x + 3;
            const rawStartY = data.cell.y + (data.cell.height - TX_TOTAL_H) / 2;
            const safeStartY = Math.max(rawStartY, data.cell.y + 2);

            doc.setDrawColor(0); doc.setLineWidth(0.3);
            doc.setFontSize(7); doc.setFont("helvetica", "normal");
            TX_LABELS.forEach((label, i) => {
                const y = safeStartY + i * TX_LINE_H;
                doc.rect(x, y, TX_BOX, TX_BOX);
                doc.text(label, x + TX_BOX + 1.5, y + TX_BOX - 0.5);
            });
        }
    });

    let finalY = doc.lastAutoTable.finalY + 20;
    if (finalY + 90 > doc.internal.pageSize.height) { doc.addPage(); finalY = 30; }

    const leftX = 20; const rightX = 120; const lineLen = 70;
    doc.setFontSize(10); doc.text("Transmitted by:", leftX, finalY); doc.text("Received by:", rightX, finalY); finalY += 25;
    doc.setFont("helvetica", "bold");
    const receivedByName = canManageFiles(state.currentUser) ? borrowerName.toUpperCase() : "";
    doc.text(state.currentUserName.toUpperCase(), leftX + (lineLen/2), finalY - 2, { align: 'center' }); doc.line(leftX, finalY, leftX + lineLen, finalY);
    doc.text(receivedByName, rightX + (lineLen/2), finalY - 2, { align: 'center' }); doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("SIGNATURE OVER PRINTED NAME", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("SIGNATURE OVER PRINTED NAME", rightX + (lineLen/2), finalY + 4, { align: 'center' });
    finalY += 15; doc.line(leftX, finalY, leftX + lineLen, finalY); doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.text("POSITION/DESIGNATION", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("POSITION/DESIGNATION", rightX + (lineLen/2), finalY + 4, { align: 'center' });
    finalY += 15; doc.line(leftX, finalY, leftX + lineLen, finalY); doc.line(rightX, finalY, rightX + lineLen, finalY);
    doc.text("DATE SIGNED", leftX + (lineLen/2), finalY + 4, { align: 'center' });
    doc.text("DATE SIGNED", rightX + (lineLen/2), finalY + 4, { align: 'center' });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) { doc.setPage(i); stampFooter(); }
    doc.save(`Transmittal_${borrowerName}_${Date.now()}.pdf`);
}  
