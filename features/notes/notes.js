import { getCurrentUser } from "../../core/auth.js";
import { loadProgress } from "../../core/db.js";

export function init() {
    console.log("Notes Module Initializing...");
    renderAllNotes();
}

async function renderAllNotes() {
    const notesContainer = document.getElementById('all-notes-container');
    if (!notesContainer) return;

    const user = getCurrentUser();
    if (!user) {
        notesContainer.innerHTML = '<div class="empty-state">Please log in to view your notes.</div>';
        return;
    }

    try {
        const logs = await loadProgress(user.uid);
        const notes = Object.entries(logs).filter(([date, data]) => data && data.note && data.note.trim().length > 0 && !data.inTrash);

        if (notes.length === 0) {
            notesContainer.innerHTML = `
                <div class="empty-state">
                    <span class="icon">📝</span>
                    <p>No notes found. Add some in the 365 Tracker!</p>
                </div>
            `;
            return;
        }

        // Sort by date descending
        notes.sort((a, b) => b[0].localeCompare(a[0]));

        notesContainer.innerHTML = notes.map(([date, data]) => {
            const dateObj = new Date(date + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('en-US', { 
                weekday: 'short', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });

            return `
                <div class="note-card">
                    <div class="note-header">
                        <span class="note-date">${formattedDate}</span>
                        <span class="note-status ${data.status || 'pending'}">${data.status || 'Pending'}</span>
                    </div>
                    <div class="note-body">${data.note}</div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error("Failed to load notes:", error);
        notesContainer.innerHTML = '<div class="empty-state">Error loading notes.</div>';
    }
}

export const onShow = renderAllNotes;
