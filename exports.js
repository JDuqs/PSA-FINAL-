// PDF & Excel Export Logic
import { state } from './state.js';
import { ADMIN_ROLES, isAnyAdmin } from './config.js';
import { showConfirm } from './utils.js';

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
    if (!checkedBoxes.length) { alert("Select at least one batch from the table."); return []; }
    
    const selectedBatchIds = Array.from(checkedBoxes).map(cb => cb.value);
    const filteredItems = sourceData.filter(item => selectedBatchIds.includes(item.unique_id));
    
    return filteredItems.sort((a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || ''), undefined, { numeric: true }));
}

export function openUnifiedExportModal() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    state.tempExportItems = null;

    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) return alert("Error: Multiple borrowers detected. Please select items for one person only.");

    const titleEl = document.getElementById('exportModalTitle');
    if(titleEl) titleEl.innerText = `Selected: ${items.length} Items`;

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
    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) bootstrap.Modal.getOrCreateInstance(exportModalEl).show();
}

// --- EXCEL EXPORT ---
export async function exportExcel() {
    if (state.currentUser.email !== ADMIN_ROLES.STATION_1 && state.currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (!rawItems.length) return;

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
    if (state.currentUser.email !== ADMIN_ROLES.STATION_1 && state.currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;

    const items = expandPhilSysItems(rawItems);
    const borrowerName = items[0].borrower || "Unknown";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Gate Pass", `Generate Gate Pass for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ compress: true });
    const firstItem = items[0];
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
    
    doc.setFont("helvetica", "normal");
    let currentY = 70; let currentX = 15; const lineHeight = 7; const pageRightMargin = 195;
    const drawUnderlined = (text, x, y) => { doc.text(text, x, y); const w = doc.getTextWidth(text); doc.line(x, y + 1, x + w, y + 1); return w; };

    doc.text("Please allow ", currentX, currentY); currentX += doc.getTextWidth("Please allow ");
    doc.setFont("helvetica", "bold"); currentX += drawUnderlined(firstItem.borrower.toUpperCase(), currentX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(" for the purpose of ", currentX, currentY); currentX += doc.getTextWidth(" for the purpose of ");
    doc.setFont("helvetica", "bold"); currentX += drawUnderlined(firstItem.project || "Official Business", currentX, currentY);
    
    currentX = 15; currentY += lineHeight;
    doc.setFont("helvetica", "normal"); doc.text("to bring out laptop equipment listed below from PSA Location to ", currentX, currentY);
    currentX += doc.getTextWidth("to bring out laptop equipment listed below from PSA Location to ");
    doc.setFont("helvetica", "bold"); currentX += drawUnderlined(firstItem.destination || "________________", currentX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(".", currentX, currentY);
    
    const formatTime = (t) => t ? new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}) : '';
    const tableBody = items.map(i => [i.description, i.serial, i.property_no || '', i.asset_no || '', i.destination, formatTime(i.time_out), i.time_return ? formatTime(i.time_return) : '']);

    doc.autoTable({
        startY: currentY + 12,
        head: [['Description of\nLaptop/Equipment', 'Serial\nNumber', 'Property\nNumber', 'Asset\nTag No.', 'Destination', 'Time\nOut', 'Time\nReturned']],
        body: tableBody, theme: 'grid', 
        margin: { bottom: 40 }, 
        styles: { textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontSize: 9, valign: 'middle', halign: 'center' },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.3, fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'left', cellWidth: 50 } }
    });

    let finalY = doc.lastAutoTable.finalY + 10;
    if (finalY + 120 > doc.internal.pageSize.height) { doc.addPage(); finalY = 20; }
    doc.text("Remarks:", 15, finalY); finalY += 6; doc.line(15, finalY, 195, finalY); finalY += 8; doc.line(15, finalY, 195, finalY); finalY += 10;

    doc.setFont("helvetica", "bold"); doc.text("Checked / Inspected by:", 15, finalY); finalY += 15;
    const drawSig = (name, title, x, y) => {
        doc.setFont("helvetica", "bold"); doc.text(name, x, y, { align: "center" });
        const w = Math.max(doc.getTextWidth(name) + 10, 60); doc.line(x - (w/2), y + 1.5, x + (w/2), y + 1.5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(doc.splitTextToSize(title, w + 30), x, y + 6, { align: "center" });
    };

    drawSig("JENOR B. BLAS", "Property and Supply Officer", 60, finalY);
    drawSig("MARY ANNE G. BASILIO", "Inspection Officer", 150, finalY);
    finalY += 25; doc.text("Approved by:", 105, finalY - 12, { align: "center" });
    drawSig("MARICEL M. CARAGAN", "Supervising Statistical Specialist\nOfficer-in-Charge, PSA NCR PSO V", 105, finalY);
    finalY += 25; drawSig("", "Guard on Duty", 105, finalY);

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); stampFooter(); }
    doc.save(`GatePass_${borrowerName}_${firstItem.unique_id}.pdf`);
}

// --- ACKNOWLEDGEMENT RECEIPT ---
export async function exportAckReceipt() {
    if (state.currentUser.email !== ADMIN_ROLES.STATION_1 && state.currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;

    const items = expandPhilSysItems(rawItems);
    const borrowers = new Set(items.map(i => (i.borrower || "").trim().toLowerCase()));
    if (borrowers.size > 1) { return alert("Error: Multiple borrowers selected."); }
    
    const borrowerName = items[0].borrower || "Unknown";
    const projectName = items[0].project || "N/A";
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modalInstance) modalInstance.hide();

    if (!await showConfirm("Export Receipt", `Generate Acknowledgement Receipt for ${borrowerName}?`)) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    
    const addFooter = (docInstance) => {
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

    try {
        doc.addImage("PSA.jpg", "JPEG", 15, 5, 25, 25, "psa", "FAST");
        doc.addImage("BP.jpg", "JPEG", 170, 5, 25, 25, "bp", "FAST");
    } catch(e) {}

    doc.setTextColor(0, 0, 0); 
    doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text("REPUBLIC OF THE PHILIPPINES", 105, 15, { align: "center" });
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("PHILIPPINE STATISTICS AUTHORITY", 105, 20, { align: "center" });
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("NCR - Provincial Statistical Office V", 105, 25, { align: "center" });
    doc.text("Las Piñas Muntinlupa Parañaque Pasay", 105, 30, { align: "center" });

    let currentY = 40;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const refNo = items[0].unique_id || `PSA-${Math.floor(1000 + Math.random() * 9000)}`; 
    doc.text(`Ref No.: ${refNo}`, 15, currentY);
    
    currentY += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Acknowledgment Form", 105, currentY, { align: "center" }); currentY += 10;

    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const text1 = "All hired field-based personnel for the specified project listed below acknowledges the receipt of the following: a) tablet, b) accessories compatible case and adapter, and c) powerbank.";
    const text2 = "All personnel who were given these devices will be held liable for any acts of negligence and malicious intent resulting to the loss or damage of these tablets. Should there be a lost/damaged tablet, the responsible personnel should immediately inform the incident to their immediate supervisor. Upon the evaluation of the Philippine Statistics Authority (PSA) Provincial Statistical Office (PSO) Chief Statistical Specialist (CSS), an anticipated cost required to repair the damage in the tablet must be shouldered by the liable personnel. In the event that the tablet is lost, a salary deduction equivalent to the market value of the comparable device must be charged against the responsible personnel. Due to this, it is crucial to exercise caution and care to the equipment/device entrusted by the PSA to every field-based personnel for the successful and secure operationalization.";
    const text3 = "Affixing your name and signature in the next page signifies that you hereby acknowledge the receipt of the above-listed devices/items under your name and fully understand the responsibilities attached to these.";
    
    const splitText1 = doc.splitTextToSize(text1, 180); doc.text(splitText1, 15, currentY);
    currentY += (splitText1.length * 5) + 5;
    const splitText2 = doc.splitTextToSize(text2, 180); doc.text(splitText2, 15, currentY);
    currentY += (splitText2.length * 5) + 5;
    const splitText3 = doc.splitTextToSize(text3, 180); doc.text(splitText3, 15, currentY);
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
}

// --- TRANSMITTAL FORM ---
export async function exportTransmittal() {
    if (state.currentUser.email !== ADMIN_ROLES.STATION_1 && state.currentUser.email !== ADMIN_ROLES.STATION_4) return alert("Unauthorized.");
    let rawItems = state.tempExportItems ? state.tempExportItems : getSelectedItems();
    if (rawItems.length === 0) return;

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
    const summaryCounts = {};
    items.forEach(item => {
        const d = (item.description || "Unknown").trim();
        let b = d;
        if(d.toLowerCase().includes('tablet')) b = "Samsung Tablet";
        else if(d.toLowerCase().includes('laptop')) b = "Laptop";
        summaryCounts[b] = (summaryCounts[b] || 0) + 1;
    });
    const summaryBody = [];
    Object.entries(summaryCounts).forEach(([n, c]) => {
        summaryBody.push([n, String(c)]);
        if (n.includes("Tablet")) { summaryBody.push(["Adapter", String(c)], ["Type C Cable", String(c)], ["Box", String(c)]); }
        else if (n.includes("Laptop")) { summaryBody.push(["Adapter/Charger", String(c)], ["Laptop Bag", String(c)], ["Mouse", String(c)]); }
    });

    doc.autoTable({
        startY: currentY, head: [['TOTAL', '']], body: summaryBody, theme: 'plain',
        margin: { bottom: 40 }, 
        styles: { fontSize: 9, textColor: [0,0,0], lineColor: [0,0,0], lineWidth: 0.3, cellPadding: 1 },
        headStyles: { fillColor: [255,255,255], lineWidth: 0.3, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 160 }, 1: { cellWidth: 20, halign: 'center' } }
    });
    currentY = doc.lastAutoTable.finalY + 10;

    // --- DETAILED ITEM TABLE ---
    const tableBody = items.map((it, idx) => {
        let acc = "-";
        const d = (it.description || "").toLowerCase();
        if (d.includes('tablet')) acc = "With type c cable, box\nand adapter";
        if (d.includes('laptop')) acc = "With charger, bag\nand mouse";
        return [idx + 1, `${it.description}\n\n${it.serial}`, it.asset_no || 'N/A', "1", acc];
    });

    doc.autoTable({
        startY: currentY,
        head: [['No.', 'ITEM NAME\n\nSERIAL No.', 'ASSET TAG No.', 'UNIT', 'ACCESSORIES']],
        body: tableBody, theme: 'plain', 
        margin: { bottom: 40 }, 
        styles: { fontSize: 9, lineColor: [0,0,0], lineWidth: 0.3, valign: 'middle', cellPadding: 3 },
        headStyles: { fillColor: [255,255,255], lineWidth: 0.3, fontStyle: 'bold', halign: 'center' },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 70 }, 2: { cellWidth: 30, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' } }
    });

    let finalY = doc.lastAutoTable.finalY + 20;
    if (finalY + 90 > doc.internal.pageSize.height) { doc.addPage(); finalY = 30; }

    const leftX = 20; const rightX = 120; const lineLen = 70;
    doc.setFontSize(10); doc.text("Transmitted by:", leftX, finalY); doc.text("Received by:", rightX, finalY); finalY += 25;
    doc.setFont("helvetica", "bold");
    doc.text(state.currentUserName.toUpperCase(), leftX + (lineLen/2), finalY - 2, { align: 'center' }); doc.line(leftX, finalY, leftX + lineLen, finalY);
    doc.text(borrowerName.toUpperCase(), rightX + (lineLen/2), finalY - 2, { align: 'center' }); doc.line(rightX, finalY, rightX + lineLen, finalY);
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