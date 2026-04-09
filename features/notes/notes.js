import { getState, subscribe } from "../../core/state.js";

export function init() {
    console.log("Notes Module Initializing...");

    // Subscribe to the Brain — auto-renders whenever logs change
    subscribe('stateReady', ({ logs, isGuest }) => renderAllNotes(logs, isGuest));
    subscribe('logsUpdated', ({ logs }) => renderAllNotes(logs, getState().isGuest));

    // If state already resolved before this module loaded, render immediately
    const { logs, isGuest } = getState();
    renderAllNotes(logs, isGuest);
}

// onShow: called by router on tab switch — zero network, reads from in-memory state
export function onShow() {
    const { logs, isGuest } = getState();
    renderAllNotes(logs, isGuest);
}

/**
 * Render notes list from state snapshot \u2014 no Firestore calls here.
 * @param {Object} logs - The logs map from globalState
 * @param {boolean} isGuest
 */
function renderAllNotes(logs = {}, isGuest = false) {
    const notesContainer = document.getElementById('all-notes-container');
    if (!notesContainer) return;

    if (isGuest) {
        notesContainer.innerHTML = '<div class="empty-state">Please log in to view your notes.</div>';
        return;
    }

    /**
     * FILTER RULE (Notes) — strict, declarative, three conditions ALL must pass:
     *   1. data.inTrash !== true   → exclude trashed items
     *   2. data.note exists        → exclude days with no note object
     *   3. data.note.trim() !== '' → exclude empty/whitespace-only notes
     */
    const notes = Object.entries(logs).filter(
        ([, data]) => data
            && data.inTrash !== true           // ← Rule 1: not in trash
            && data.note                       // ← Rule 2: note field exists
            && data.note.trim().length > 0     // ← Rule 3: non-empty
    );

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
}
