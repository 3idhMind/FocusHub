import { getCurrentUser } from "../../core/auth.js";
import { loadProgress, deleteDayLog, updateInTrash } from "../../core/db.js";

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
        trashModule.renderTrash();
    },

    renderTrash: async () => {
        const trashList = document.getElementById('trash-list');
        if (!trashList) return;

        const user = getCurrentUser();
        if (!user) {
            trashList.innerHTML = '<div class="empty-trash-state">Please log in to view trash.</div>';
            return;
        }

        try {
            const logs = await loadProgress(user.uid);
            const now = new Date();
            const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

            const trashItems = [];
            const autoDeletePromises = [];

            for (const [date, data] of Object.entries(logs)) {
                if (data && data.inTrash === true) {
                    // Priority: deletedAt > updatedAt > current time (fallback)
                    const deletionTime = data.deletedAt ? new Date(data.deletedAt) : 
                                       (data.updatedAt ? new Date(data.updatedAt) : new Date());
                    
                    const timeDiff = now - deletionTime;
                    
                    if (timeDiff > thirtyDaysInMs) {
                        console.log(`Auto-deleting expired trash item: ${date}`);
                        autoDeletePromises.push(deleteDayLog(user.uid, date));
                        if (window.trackerCache) delete window.trackerCache[date];
                    } else {
                        const daysRemaining = Math.ceil((thirtyDaysInMs - timeDiff) / (24 * 60 * 60 * 1000));
                        trashItems.push({ date, data, daysRemaining });
                    }
                }
            }

            // Wait for all auto-deletions to finish
            if (autoDeletePromises.length > 0) {
                await Promise.all(autoDeletePromises);
                console.log(`Auto-deleted ${autoDeletePromises.length} items.`);
            }

            if (trashItems.length === 0) {
                trashList.innerHTML = `
                    <div class="empty-trash-state">
                        <span class="empty-trash-icon">🗑️</span>
                        <p>Your trash is empty. No deleted logs found.</p>
                    </div>
                `;
                return;
            }

            // Sort by date descending
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

        } catch (error) {
            console.error("Failed to load trash:", error);
            trashList.innerHTML = '<div class="empty-trash-state">Error loading trash. Please try again.</div>';
        }
    },

    restoreItem: async (date) => {
        const user = getCurrentUser();
        if (!user) return;

        try {
            await updateInTrash(user.uid, date, false);
            
            if (window.trackerCache && window.trackerCache[date]) {
                window.trackerCache[date].inTrash = false;
            }
            
            console.log(`Restored item for ${date}`);
            trashModule.renderTrash();
            
            import("../../core/auth.js").then(m => m.showToast(`Restored note for ${date}`));
        } catch (error) {
            console.error("Failed to restore item:", error);
        }
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

        const user = getCurrentUser();
        if (!user) return;

        try {
            console.log("Trash: Permanently deleting:", date);
            await deleteDayLog(user.uid, date);
            
            if (window.trackerCache) {
                delete window.trackerCache[date];
            }
            
            trashModule.closeConfirmModal();
            trashModule.renderTrash();
            
            import("../../core/auth.js").then(m => m.showToast(`Permanently deleted log for ${date}`));
        } catch (error) {
            console.error("Failed to delete item forever:", error);
        }
    }
};

// Expose to window
window.trashModule = trashModule;

export const init = trashModule.init;
export const onShow = trashModule.renderTrash;

// Listen for Auth changes to sync data
window.addEventListener('authChanged', (e) => {
    const user = e.detail.user;
    if (user) {
        const trashList = document.getElementById('trash-list');
        if (trashList) {
            trashModule.renderTrash();
        }
    }
});
