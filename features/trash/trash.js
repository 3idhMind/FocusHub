import { showToast } from "../../core/auth.js";
import { getState, subscribe, dispatchRestoreFromTrash, dispatchDeleteDay } from "../../core/state.js";

// Persistent state across module re-loads
if (!window.trashState) {
    window.trashState = {
        dateToDelete: null
    };
}

// Global module object
const trashModule = {
    init: () => {
        console.log("Trash: Initializing...");

        // Subscribe to the Brain — re-renders automatically when any module mutates logs
        subscribe('stateReady', ({ logs, isGuest }) => trashModule.renderTrash(logs, isGuest));
        subscribe('logsUpdated', ({ logs }) => trashModule.renderTrash(logs, getState().isGuest));

        // If state already resolved, render now
        const { logs, isGuest } = getState();
        trashModule.renderTrash(logs, isGuest);
    },

    // onShow: called by router on tab switch — reads from Brain, zero network
    renderTrash: (logs, isGuest) => {
        // Allow calling with no args from onShow — pull current state
        if (!logs) ({ logs, isGuest } = getState());

        const trashList = document.getElementById('trash-list');
        if (!trashList) return;

        if (isGuest) {
            trashList.innerHTML = '<div class="empty-trash-state">Please log in to view trash.</div>';
            return;
        }

        const now = new Date();
        const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
        const trashItems = [];
        const autoDeleteKeys = [];

        /**
         * FILTER RULE (Trash) — strict, declarative, one condition:
         *   inTrash === true  → show in Trash view (regardless of status or note content)
         *   inTrash !== true  → EXCLUDE — active logs never appear in Trash
         * The '=== true' strict equality guard prevents null/undefined from leaking through.
         */
        for (const [date, data] of Object.entries(logs)) {
            if (data && data.inTrash === true) {  // ← strict: must be explicitly true
                const deletionTime = data.deletedAt ? new Date(data.deletedAt)
                    : (data.updatedAt ? new Date(data.updatedAt) : new Date());
                const timeDiff = now - deletionTime;

                if (timeDiff > thirtyDaysInMs) {
                    console.log(`Auto-deleting expired trash item: ${date}`);
                    autoDeleteKeys.push(date);
                } else {
                    const daysRemaining = Math.ceil((thirtyDaysInMs - timeDiff) / (24 * 60 * 60 * 1000));
                    trashItems.push({ date, data, daysRemaining });
                }
            }
        }

        // Dispatch auto-deletions via Brain (not direct db calls)
        autoDeleteKeys.forEach(date => dispatchDeleteDay(date));

        if (trashItems.length === 0) {
            trashList.innerHTML = `
                <div class="empty-trash-state">
                    <span class="empty-trash-icon">🗑️</span>
                    <p>Your trash is empty. No deleted logs found.</p>
                </div>
            `;
            return;
        }

        trashItems.sort((a, b) => b.date.localeCompare(a.date));

        trashList.innerHTML = trashItems.map(({ date, data, daysRemaining }) => {
            const dateObj = new Date(date + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            return `
                <div class="trash-item" data-date="${date}">
                    <div class="trash-info">
                        <div class="trash-date">${formattedDate}</div>
                        <div class="trash-note">${data.note || 'No note attached.'}</div>
                        <div class="trash-remaining">⏳ ${daysRemaining} days remaining until permanent deletion</div>
                    </div>
                    <div class="trash-actions">
                        <button class="trash-btn btn-restore" onclick="window.trashModule.restoreItem('${date}')">
                            ♻️ Restore
                        </button>
                        <button class="trash-btn btn-delete-forever" onclick="window.trashModule.openConfirmModal('${date}')">
                            🛑 Delete Forever
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    restoreItem: async (date) => {
        // Dispatch to Brain — it updates state, notifies all modules, then syncs to Firestore
        dispatchRestoreFromTrash(date);
        showToast(`Restored note for ${date}`);
        console.log(`Dispatched restore for ${date}`);
    },

    openConfirmModal: (date) => {
        console.log("Trash: Opening confirm modal for:", date);
        window.trashState.dateToDelete = date;
        const modal = document.getElementById('trash-confirm-modal');
        if (modal) {
            modal.classList.remove('hidden');
        } else {
            console.error("Modal element not found!");
        }
    },

    closeConfirmModal: () => {
        const modal = document.getElementById('trash-confirm-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        window.trashState.dateToDelete = null;
    },

    confirmDelete: async () => {
        const date = window.trashState.dateToDelete;
        if (!date) {
            console.error("Trash: No date selected for deletion");
            return;
        }

        console.log("Trash: Permanently deleting:", date);
        // Dispatch hard delete to Brain — it removes from globalState and Firestore
        dispatchDeleteDay(date);

        trashModule.closeConfirmModal();
        showToast(`Permanently deleted log for ${date}`);
    }
};

// Expose to window
window.trashModule = trashModule;

export const init = trashModule.init;
export const onShow = () => trashModule.renderTrash();

// NOTE: The old 'authChanged' window listener is removed.
// The Brain (state.js) now owns post-login re-hydration via onAuthChange() → notify('logsUpdated').
