// Utility Functions
import { supabase } from './config.js';

export function showConfirm(title, message) {
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

// --- UPDATED ID GENERATION: STRICT HIGHEST NUMBER + 1 ---
export async function getNextGatePassID() {
    try {
        // 1. Generate Date Parts for Prefix: YY-MM-
        const now = new Date();
        const year = String(now.getFullYear()).slice(-2); // Last 2 digits (e.g., "26")
        const month = String(now.getMonth() + 1).padStart(2, '0'); // 2-digit month (e.g., "02")
        const prefix = `${year}-${month}-`; // Result: "26-02-"

        // 2. Query DB for existing IDs with this prefix
        const { data: localData, error } = await supabase
            .from('gate_passes')
            .select('unique_id')
            .ilike('unique_id', `${prefix}%`); // Looks for '26-02-%'

        if (error) throw error;

        // 3. Find the ABSOLUTE HIGHEST number currently in the database for this month
        let maxNum = 0;
        if (localData && localData.length > 0) {
            localData.forEach(row => {
                // Expected format: YY-MM-NN (e.g., "26-02-105")
                const parts = row.unique_id.split('-');
                if (parts.length >= 3) {
                    const num = parseInt(parts[2], 10); 
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num; // Keep updating to find the highest number
                    }
                }
            });
        }

        // 4. Always add 1 to the highest number found
        const nextNum = maxNum + 1;

        // 5. Format and Return
        // Pad with leading zero ONLY if it is less than 10 (e.g., 2 becomes "02", but 106 stays "106")
        const nextNumStr = nextNum < 10 ? `0${nextNum}` : String(nextNum);

        return `${prefix}${nextNumStr}`; // Result: "26-02-106"
        
    } catch (e) {
        console.error("ID Generation Error:", e);
        // Fallback: Generate a random ID with the correct format to prevent blockage
        const now = new Date();
        const y = String(now.getFullYear()).slice(-2);
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const r = String(Math.floor(Math.random() * 1000)).padStart(2, '0');
        return `${y}-${m}-${r}`;
    }
}

export function updateClock() {
    const timeEl = document.getElementById('clockTime');
    const dateEl = document.getElementById('clockDate');
    if(!timeEl) return;
    setInterval(() => {
        const now = new Date();
        dateEl.innerText = now.toDateString();
        timeEl.innerText = now.toLocaleTimeString();
    }, 1000);
}