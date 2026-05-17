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

// --- GATE PASS ID GENERATION: CURRENT YY-MM + GLOBAL HIGHEST NUMBER + 1 ---
export async function getNextGatePassID() {
    try {
        // 1. Generate current date prefix: YY-MM-
        const now = new Date();
        const year = String(now.getFullYear()).slice(-2);
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const prefix = `${year}-${month}-`;

        // 2. Read existing unique IDs from the table and find the highest numeric suffix overall.
        // This prevents the counter from resetting when the month changes.
        const { data: existingIds, error } = await supabase
            .from('gate_passes')
            .select('unique_id')
            .not('unique_id', 'is', null);

        if (error) throw error;

        // 3. Find the highest sequence number from IDs shaped like YY-MM-NNN...
        let maxNum = 0;
        if (existingIds && existingIds.length > 0) {
            existingIds.forEach(row => {
                const match = String(row.unique_id || '').trim().match(/^(\d{2})-(\d{2})-(\d+)$/);
                if (match) {
                    const num = parseInt(match[3], 10);
                    if (!isNaN(num) && num > maxNum) {
                        maxNum = num;
                    }
                }
            });
        }

        // 4. Continue from the highest number already used in the whole table.
        const nextNum = maxNum + 1;
        const nextNumStr = nextNum < 10 ? `0${nextNum}` : String(nextNum);

        return `${prefix}${nextNumStr}`;
        
    } catch (e) {
        console.error("ID Generation Error:", e);
        // Fallback keeps the current date prefix but uses a timestamp-based suffix to avoid obvious collisions.
        const now = new Date();
        const y = String(now.getFullYear()).slice(-2);
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const r = String(Date.now()).slice(-6);
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
