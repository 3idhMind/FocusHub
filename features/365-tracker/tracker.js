import { getCurrentUser, triggerFearOfLoss, showToast } from "../../core/auth.js";
import { getState, subscribe, dispatchUpdateDay, dispatchMoveToTrash } from "../../core/state.js";

let CURRENT_YEAR = new Date().getFullYear();
let currentModalDate = null;
let currentModalStatus = 'pending';
let currentModalNote = '';

// Persist cache across navigations to avoid "revert" effect during slow syncs
if (!window.trackerCache) {
    window.trackerCache = {};
}

const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

export function init() {
    console.log("Tracker Feature Initializing...");

    // Subscribe ONCE to the Brain. When state is ready or logs change, re-paint the calendar.
    subscribe('stateReady', ({ logs }) => { buildCalendar(CURRENT_YEAR, logs); applyLogsToCalendar(logs); });
    subscribe('logsUpdated', ({ logs }) => applyLogsToCalendar(logs));

    // Build the empty calendar shell first (no logs needed yet)
    buildCalendar(CURRENT_YEAR, {});
    setupEventListeners();

    // If state is already available (e.g., module loaded after stateReady fired), paint now.
    const { logs, isGuest } = getState();
    if (!isGuest && Object.keys(logs).length > 0) {
        buildCalendar(CURRENT_YEAR, logs);
        applyLogsToCalendar(logs);
    }
}

// onShow: called by router on every tab switch — repaints from current in-memory state (zero network)
export function onShow() {
    const { logs } = getState();
    applyLogsToCalendar(logs);
}

function buildCalendar(year, logs = {}) {
    const yearDisplay = document.getElementById('yearDisplay');
    if (yearDisplay) {
        yearDisplay.innerText = year;
    }
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    
    if (!thead || !tbody) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    const totalDaysInYear = isLeapYear(year) ? 366 : 365;
    const MAX_COLS = 37;

    let headTr = document.createElement('tr');
    headTr.innerHTML = `
        <th class="month-col">MONTH</th>
        <th class="empty-col"></th>
    `;
    for (let i = 0; i < MAX_COLS; i++) {
        headTr.innerHTML += `<th class="day-col-width">${weekdays[i % 7]}</th>`;
    }
    thead.appendChild(headTr);

    let globalSpendDay = 1; 
    
    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
    
    for (let month = 0; month < 12; month++) {
        let tr = document.createElement('tr');

        let tdMonth = document.createElement('td');
        tdMonth.className = 'month-col';
        tdMonth.innerText = monthNames[month];
        tr.appendChild(tdMonth);

        let tdEmpty = document.createElement('td');
        tdEmpty.className = 'empty-col';
        tr.appendChild(tdEmpty);

        let daysInThisMonth = new Date(year, month + 1, 0).getDate();
        let startDayOffset = new Date(year, month, 1).getDay();

        for (let i = 0; i < startDayOffset; i++) {
            let tdBlank = document.createElement('td');
            tdBlank.className = 'day-col-width';
            tr.appendChild(tdBlank);
        }

        for (let day = 1; day <= daysInThisMonth; day++) {
            let leftDays = totalDaysInYear - globalSpendDay;
            let spendDays = globalSpendDay;
            let dateKey = formatDateKey(year, month, day);

            let tdDay = document.createElement('td');
            tdDay.className = 'day-cell has-date';
            tdDay.dataset.date = dateKey;

            tdDay.innerHTML = `
                <div class="box-inner" title="Day ${spendDays} of the year. ${leftDays} days left.">
                    <div class="date-val">${day}</div>
                    <div class="left-val">${leftDays}</div>
                    <div class="spend-val">${spendDays}</div>
                    <div class="status-indicator"></div>
                </div>
            `;

            // Seed local render cache from state snapshot passed into buildCalendar
            const cachedData = (logs && logs[dateKey]) ? logs[dateKey] : (window.trackerCache || {})[dateKey];
            if (cachedData) {
                const status = cachedData.status || 'pending';
                const note = cachedData.note || '';
                const inTrash = cachedData.inTrash || false;
                
                if (!inTrash) {
                    const hasNote = note && note.trim().length > 0;
                    if (status === 'completed' && hasNote) tdDay.classList.add('tick-note');
                    else if (status === 'skipped' && hasNote) tdDay.classList.add('cross-note');
                    else if (status === 'completed') tdDay.classList.add('status-tick');
                    else if (status === 'skipped') tdDay.classList.add('status-cross');
                    else if (hasNote) tdDay.classList.add('has-note');
                }
            }

            if (dateKey === todayKey) {
                tdDay.classList.add('is-today');
            }

            tdDay.onclick = function() {
                openDayModal(dateKey);
            };

            tr.appendChild(tdDay);
            globalSpendDay++;
        }

        let remainingCols = MAX_COLS - (startDayOffset + daysInThisMonth);
        for (let i = 0; i < remainingCols; i++) {
            let tdBlank = document.createElement('td');
            tdBlank.className = 'day-col-width';
            tr.appendChild(tdBlank);
        }

        tbody.appendChild(tr);
    }
}

function setupEventListeners() {
    const yearDisplay = document.getElementById('yearDisplay');
    const yearInput = document.getElementById('yearInput');
    const scrollContainer = document.getElementById('scrollContainer');
    const popup = document.getElementById('action-popup');

    if (yearDisplay) {
        yearDisplay.onclick = editYear;
    }

    if (yearInput) {
        yearInput.onblur = saveYear;
        yearInput.onkeydown = handleYearKey;
    }

    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', function() {
            hidePopup();
        });
    }

    // Global click listener to hide popup
    document.addEventListener('click', function(e) {
        const popup = document.getElementById('action-popup');
        if (popup && popup.classList.contains('active')) {
            // Don't hide if clicking inside the popup or on a day cell (which opens it)
            if (!popup.contains(e.target) && !e.target.closest('.day-cell')) {
                console.log("Global click hiding popup");
                hidePopup();
            }
        }
    });
}

/**
 * Popover Interaction Logic
 */
export async function openDayModal(dateKey) {
    console.log(`Opening tracker popup for: ${dateKey}`);
    currentModalDate = dateKey;
    const popup = document.getElementById('action-popup');
    const cell = document.querySelector(`[data-date="${dateKey}"]`);
    
    if (!popup || !cell) {
        console.error("Popup or Cell not found!");
        return;
    }

    // Reset state first to avoid showing previous date's data
    currentModalNote = '';
    currentModalStatus = 'pending';
    
    // Update popup header
    const popupDate = document.getElementById('popup-date');
    const popupStatus = document.getElementById('popup-status');
    if (popupDate) {
        const dateObj = new Date(dateKey + 'T00:00:00');
        popupDate.innerText = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (popupStatus) popupStatus.innerText = 'Pending';

    // Read from the Brain's in-memory state (zero network cost)
    const { logs, uid } = getState();
    if (uid) {
        const dayData = logs[dateKey];
        if (dayData) {
            currentModalStatus = dayData.status || 'pending';
            currentModalNote = dayData.note || '';
        } else {
            currentModalStatus = 'pending';
            currentModalNote = '';
        }

        if (popupStatus) {
            if (currentModalStatus === 'completed') popupStatus.innerText = 'Completed';
            else if (currentModalStatus === 'skipped') popupStatus.innerText = 'Skipped';
            else if (currentModalNote) popupStatus.innerText = 'Task Added';
            else popupStatus.innerText = 'Pending';
        }
    }

    // Position the popup
    const rect = cell.getBoundingClientRect();
    
    // Calculate position (relative to viewport since it's position: fixed)
    let top = rect.top + rect.height / 2;
    let left = rect.left + rect.width / 2;

    // Adjust if too close to edges
    const popupWidth = 160;
    const popupHeight = 200;

    if (left + popupWidth > window.innerWidth) {
        left = rect.left - popupWidth;
    }
    if (top + popupHeight > window.innerHeight) {
        top = rect.top - popupHeight;
    }

    popup.style.display = ''; // Clear inline display from router
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.classList.add('active');
    popup.classList.remove('hidden');
}

export async function updateStatus(status) {
    if (!currentModalDate) return;
    
    console.log(`Updating status to: ${status} for ${currentModalDate}`);
    currentModalStatus = status; // Update local state
    
    const dateKey = currentModalDate;
    const user = getCurrentUser();

    // Update popup status text
    const popupStatus = document.getElementById('popup-status');
    if (popupStatus) {
        if (status === 'completed') popupStatus.innerText = 'Completed';
        else if (status === 'skipped') popupStatus.innerText = 'Skipped';
        else if (currentModalNote) popupStatus.innerText = 'Task Added';
        else popupStatus.innerText = 'Pending';
    }

    // Optimistic UI: update cell immediately
    updateCellUI(dateKey, status, currentModalNote);

    if (user) {
        // Dispatch to the Brain — it updates state, notifies all modules, then syncs to Firestore
        dispatchUpdateDay(dateKey, { status, note: currentModalNote });
    } else {
        if (status === 'completed') triggerFearOfLoss();
    }

    hidePopup();
}

export async function clearDay() {
    if (!currentModalDate) return;
    
    console.log(`Clearing day: ${currentModalDate}`);
    const dateKey = currentModalDate;
    const user = getCurrentUser();
    
    // Root Cause Fix: Ensure we have the latest note from cache if currentModalNote is empty
    if (!currentModalNote && window.trackerCache[dateKey]) {
        currentModalNote = window.trackerCache[dateKey].note || '';
    }

    // If there's a note, move to trash. If not, just clear.
    const hasNote = currentModalNote && currentModalNote.trim().length > 0;
    
    // Update popup status text
    const popupStatus = document.getElementById('popup-status');
    if (popupStatus) popupStatus.innerText = 'Pending';

    // Optimistic UI: clear cell visually
    updateCellUI(dateKey, 'pending', currentModalNote, hasNote);

    if (user) {
        if (hasNote) {
            // Move to Trash via Brain dispatch
            dispatchMoveToTrash(dateKey);
            showToast(`Moved note to Trash`);
        } else {
            // Just clear the day status
            dispatchUpdateDay(dateKey, { status: null, note: '' });
        }
    }

    currentModalStatus = 'pending';
    currentModalNote = '';
    hidePopup();
}

export function openDiary() {
    if (!currentModalDate) return;
    
    hidePopup();
    
    // Open full-screen diary
    const diaryModal = document.getElementById('diary-modal');
    const diaryDateTitle = document.getElementById('diary-modal-date-title');
    const diaryNoteArea = document.getElementById('diary-note-area');
    
    const dateObj = new Date(currentModalDate + 'T00:00:00');
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    diaryDateTitle.innerText = dateObj.toLocaleDateString('en-US', options);
    
    diaryNoteArea.value = currentModalNote;
    diaryModal.classList.remove('hidden');
}

function hidePopup() {
    const popup = document.getElementById('action-popup');
    if (popup) {
        popup.classList.remove('active');
        popup.classList.add('hidden');
    }
}

export function closeDiary() {
    document.getElementById('diary-modal').classList.add('hidden');
}

export async function saveDiaryNote() {
    if (!currentModalDate) return;
    
    const note = document.getElementById('diary-note-area').value;
    
    if (note && note.length > 500) {
        import("../../core/auth.js").then(m => m.showToast("Note is too long (max 500 characters)"));
        return;
    }
    
    currentModalNote = note;
    const user = getCurrentUser();

    // Optimistic UI update
    updateCellUI(currentModalDate, currentModalStatus, note);

    if (user) {
        // Dispatch to Brain — no direct db.js call
        dispatchUpdateDay(currentModalDate, { status: currentModalStatus, note });
        console.log("Diary note dispatched to state.");
    }

    document.getElementById('diary-modal').classList.add('hidden');
}

export function readNote() {
    if (!currentModalDate) return;
    
    if (!currentModalNote || currentModalNote.trim().length === 0) {
        // Do nothing as requested, avoid showing empty diary
        return;
    }
    
    openDiary(); // Reuse diary modal for reading
}

function updateCellUI(dateKey, status, note, inTrash = false) {
    const cell = document.querySelector(`[data-date="${dateKey}"]`);
    if (!cell) return;

    // Update the local render cache (sourced from globalState, mirrored here for DOM paint speed)
    if (!window.trackerCache) window.trackerCache = {};
    if (!window.trackerCache[dateKey]) window.trackerCache[dateKey] = {};
    window.trackerCache[dateKey].status = status;
    window.trackerCache[dateKey].note = note;
    window.trackerCache[dateKey].inTrash = inTrash;

    // Reset classes
    cell.classList.remove('status-tick', 'status-cross', 'has-note', 'tick-note', 'cross-note');

    // Root Cause Fix: If inTrash is true, we still want to keep the note in the cache 
    // but hide it from the calendar UI.
    if (inTrash) return; 

    const hasNote = note && note.trim().length > 0;

    if (status === 'completed' && hasNote) {
        cell.classList.add('tick-note');
    } else if (status === 'skipped' && hasNote) {
        cell.classList.add('cross-note');
    } else if (status === 'completed') {
        cell.classList.add('status-tick');
    } else if (status === 'skipped') {
        cell.classList.add('status-cross');
    } else if (hasNote) {
        cell.classList.add('has-note');
    }
}

/**
 * applyLogsToCalendar — The Brain pushes logs here.
 * Reads exclusively from state (no Firestore, no fetch).
 *
 * FILTER RULE (Tracker):
 *   inTrash === true  → reset cell to blank (hide from calendar view)
 *   inTrash === false → paint cell with status/note classes as normal
 */
function applyLogsToCalendar(logs) {
    if (!logs) return;
    window.trackerCache = { ...logs }; // Mirror state into local render cache

    Object.keys(logs).forEach(dateKey => {
        const dayData = logs[dateKey];
        if (!dayData || typeof dayData !== 'object') return;

        const { status, note = '', inTrash = false } = dayData;

        if (inTrash) {
            // FILTER: explicitly reset this cell — do not leave stale colour classes
            updateCellUI(dateKey, null, '', true);
        } else {
            // PASS: active log — paint with correct status + note combination
            updateCellUI(dateKey, status, note, false);
        }
    });
}

/**
 * Helper to format date as YYYY-MM-DD
 */
function formatDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function editYear() {
    const display = document.getElementById('yearDisplay');
    const input = document.getElementById('yearInput');
    
    display.style.display = 'none';
    input.style.display = 'inline-block';
    input.value = CURRENT_YEAR;
    input.focus();
    input.select();
}

function saveYear() {
    const display = document.getElementById('yearDisplay');
    const input = document.getElementById('yearInput');
    
    if (input.style.display === 'none') return;
    
    let newYear = parseInt(input.value);
    if (!isNaN(newYear) && newYear > 1900 && newYear < 2100) {
        if (CURRENT_YEAR !== newYear) {
            CURRENT_YEAR = newYear;
            const { logs } = getState();
            buildCalendar(CURRENT_YEAR, logs);
            applyLogsToCalendar(logs);
        }
    } else {
        input.value = CURRENT_YEAR;
    }
    
    input.style.display = 'none';
    display.style.display = 'inline-block';
    display.innerText = CURRENT_YEAR;
}

function handleYearKey(event) {
    if (event.key === 'Enter') {
        saveYear();
    } else if (event.key === 'Escape') {
        const display = document.getElementById('yearDisplay');
        const input = document.getElementById('yearInput');
        input.value = CURRENT_YEAR;
        input.style.display = 'none';
        display.style.display = 'inline-block';
    }
}

// Expose to window for the modal buttons
window.tracker = {
    updateStatus,
    clearDay,
    openDiary,
    readNote,
    closeDiary,
    saveDiaryNote
};

// NOTE: The old 'authChanged' window listener is removed.
// The Brain (state.js) now owns post-login re-hydration via onAuthChange() → notify('logsUpdated').
