/**
 * core/state.js — The Brain (Centralized State Manager)
 * Version: 2.0 — Production Hardened
 *
 * ARCHITECTURE CONTRACT:
 *   1. UI modules NEVER import from db.js directly.
 *   2. UI modules NEVER read globalState directly — they subscribe to events.
 *   3. State mutations flow in one direction only:
 *      UI → dispatch*() → [snapshot] → globalState → notify() → UI re-render
 *                                                   ↓
 *                                             db.js (async, background)
 *                                                   ↓ (on failure)
 *                                     restore snapshot → notify() [rollback]
 *
 * This file is the ONLY bridge between the UI and the database layer.
 */

import {
    loadProgress,
    getUserProfile,
    initUserProfile,
    updateDayLog,
    updateInTrash,
    deleteDayLog,
    saveUserProfile,
    invalidateCache,
} from './db.js';



// ─────────────────────────────────────────────
// 1. THE GLOBAL STATE OBJECT
//    The single source of truth for all runtime data.
//    Never mutated directly from outside this file.
// ─────────────────────────────────────────────
const globalState = {
    uid: null,           // Confirmed Firebase UID (null = Guest)
    logs: {},            // { "YYYY-MM-DD": { status, note, inTrash, ... } }
    profile: null,       // { firstName, lastName, email, ... }
    isGuest: true,       // Derived: true if uid is null
    isLoading: false,    // True while initial cloud sync is in progress
    authView: 'login'    // active view in auth modal ('login', 'signup', 'reset')
};

// ─────────────────────────────────────────────
// 2. PUB/SUB ENGINE
//    A minimal, dependency-free event bus.
//    UI modules subscribe to named channels.
//    The Brain notifies all subscribers when state changes.
// ─────────────────────────────────────────────
let _subscribers = {}; // { 'eventName': [callback, ...] }  ← 'let' for reset on auth change

/**
 * Subscribe a callback to a named event channel.
 * @param {string} event - e.g. 'logsUpdated', 'profileUpdated', 'stateReady'
 * @param {Function} callback - Receives the relevant state slice as argument
 * @param {Object} [options] - subscription options
 * @param {boolean} [options.persistent] - If true, this listener survives _resetSubscribers (System Level)
 * @returns {Function} Unsubscribe handle
 */
export function subscribe(event, callback, options = {}) {
    if (!_subscribers[event]) _subscribers[event] = [];
    
    // Tag the callback for internal filtering
    if (options.persistent) {
        callback._isPersistent = true;
    }
    
    _subscribers[event].push(callback);
    return () => {
        if (_subscribers[event]) {
            _subscribers[event] = _subscribers[event].filter(cb => cb !== callback);
        }
    };
}

/**
 * dispatchNotification — Centralized messaging system.
 * Allows any module to trigger a UI notification (Toast) via the Brain.
 * @param {string} message 
 * @param {string} type - 'info', 'success', 'error'
 */
export function dispatchNotification(message, type = 'info') {
    // We don't necessarily need to store this in globalState if it's ephemeral,
    // but the notify system expects state-derived data.
    // For ephemeral events, we pass the data directly through notify.
    _notifyEphemeral('notification', { message, type });
}

/**
 * FIX #1 (Memory Leak): Reset all subscriptions.
 * Called by initState() on every auth change so stale module callbacks
 * from a previous user session cannot accumulate in the registry.
 * Modules re-subscribe naturally when the router re-initializes their init().
 *
 * NOTE: The router keeps DOM wrappers alive but does NOT re-call init() on
 * tab switch — only onShow(). Subscribers added in init() persist across
 * tab switches (correct). They are purged only on full auth re-boot (correct).
 */
function _resetSubscribers() {
    const newSubscribers = {};
    
    // Preserve persistent (System level) listeners
    Object.keys(_subscribers).forEach(event => {
        const persistentListeners = _subscribers[event].filter(cb => cb._isPersistent);
        if (persistentListeners.length > 0) {
            newSubscribers[event] = persistentListeners;
        }
    });

    _subscribers = newSubscribers;
    console.log('State: Non-persistent (feature level) subscriptions cleared.');
}

/**
 * Update the active view in the Auth Modal.
 * Supports: 'login', 'signup', 'reset', 'reset-confirm', 'reset-success', 'exists', 'update-password', 'reset-error'
 * @param {string} view 
 */
export function dispatchSetAuthView(view) {
    globalState.authView = view;
    notify('authViewUpdated');
}

/**
 * Notify all subscribers of a named event.
 *
 * FIX #4 (Immutability): Uses structuredClone() for a true deep copy of logs,
 * preventing subscriber callbacks from mutating globalState via object reference.
 * @param {string} event
 */
function notify(event, data = null) {
    if (!_subscribers[event]) return;
    const payload = data || _buildPayload(event);
    _subscribers[event].forEach(cb => {
        try { cb(payload); }
        catch (e) { console.error(`State: subscriber error on '${event}':`, e); }
    });
}

/**
 * Internal helper to notify with a direct payload (for ephemeral syncs/toasts).
 */
function _notifyEphemeral(event, payload) {
    if (!_subscribers[event]) return;
    _subscribers[event].forEach(cb => {
        try { cb(payload); }
        catch (e) { console.error(`State: ephemeral subscriber error on '${event}':`, e); }
    });
}

function _buildPayload(event) {
    // FIX #4: structuredClone creates a full deep copy — no reference leakage
    switch (event) {
        case 'logsUpdated':
            return { logs: structuredClone(globalState.logs), uid: globalState.uid };
        case 'profileUpdated':
            return { profile: structuredClone(globalState.profile), uid: globalState.uid };
        case 'stateReady':
            return {
                uid: globalState.uid,
                isGuest: globalState.isGuest,
                logs: structuredClone(globalState.logs),
                profile: globalState.profile ? structuredClone(globalState.profile) : null,
                authView: globalState.authView
            };
        case 'authChanged':
            return { uid: globalState.uid, isGuest: globalState.isGuest };
        case 'authViewUpdated':
            return { authView: globalState.authView };
        default:
            return {};
    }
}

// ─────────────────────────────────────────────
// 3. HYDRATION (Internal, not exported)
//    Shared data-fetching logic used by both initState and onAuthChange.
//    Separated so we don't duplicate the fetch logic or double-notify.
// ─────────────────────────────────────────────

/**
 * _hydrate: Internal. Populates globalState from Firestore for an authenticated user.
 * Does NOT call notify() — the caller decides which event to fire afterward.
 * @param {import('firebase/auth').User} user
 */
async function _hydrate(user) {
    globalState.uid = user.uid;
    globalState.isGuest = false;
    globalState.isLoading = true;

    try {
        // STEP 1: Ensure users/{uid} document exists and has all v2 schema fields.
        // This is idempotent — safe to call on every login.
        // Must run BEFORE getUserProfile() so the document is guaranteed to exist.
        await initUserProfile(user);

        // STEP 2: Parallel-fetch logs and profile now that the document is confirmed.
        const [logs, profile] = await Promise.all([
            loadProgress(user.uid),
            getUserProfile(user.uid)
        ]);
        globalState.logs = logs || {};
        globalState.profile = profile || null;
        console.log(`State: Hydrated ${Object.keys(globalState.logs).length} log entries for UID: ${user.uid}`);
    } catch (e) {
        console.error('State: Hydration failed:', e);
        globalState.logs = {};
        globalState.profile = null;
    } finally {
        globalState.isLoading = false;
    }
}

// ─────────────────────────────────────────────
// 4. INITIALIZER — Boot-time only
//    Called ONCE by app.js after the Auth Gate resolves.
// ─────────────────────────────────────────────

/**
 * initState — Boot-time initializer. Called exactly once on app start.
 * FIX #1: Resets subscription registry before hydrating to prevent
 *         stale callbacks from a previous session accumulating.
 * FIX #3: Fires 'stateReady' only — never 'authChanged' — on boot.
 * @param {import('firebase/auth').User | null} user
 */
export async function initState(user) {
    // Purge any stale subscribers before re-hydrating
    _resetSubscribers();

    if (user) {
        await _hydrate(user);
    } else {
        globalState.uid = null;
        globalState.isGuest = true;
        globalState.logs = {};
        globalState.profile = null;
        globalState.isLoading = false;
        console.log('State: Guest mode. Local-only state initialized.');
    }

    // Boot signal: ALL modules initialize their UI from this single event.
    // FIX #3: This is the ONLY place 'stateReady' is fired.
    notify('stateReady');
}

/**
 * onAuthChange — Post-boot auth transitions (login / logout after app is running).
 * FIX #3: Uses _hydrate() directly so it fires 'authChanged' only,
 *         never duplicating 'stateReady' (which is a boot-time event).
 * @param {import('firebase/auth').User | null} user
 */
export async function onAuthChange(user) {
    console.log('State: Auth transition detected post-boot. Re-hydrating...');

    // FIX #4: Clear the db.js in-memory cache so previous user's data
    // is never served to the incoming user session.
    invalidateCache();

    if (user) {
        await _hydrate(user);
    } else {
        globalState.uid = null;
        globalState.isGuest = true;
        globalState.logs = {};
        globalState.profile = null;
        console.log('State: Logged out. State cleared to Guest mode.');
    }

    // Post-boot signal: modules subscribed to 'authChanged' re-render.
    // 'stateReady' is intentionally NOT fired here.
    notify('authChanged');
    notify('logsUpdated'); // Re-render all data-bound UI after auth switch
}

// ─────────────────────────────────────────────
// 5. READ ACCESSOR (Safe, Read-Only Snapshot)
// ─────────────────────────────────────────────

/** @returns {{ logs: object, profile: object|null, uid: string|null, isGuest: boolean }} */
export function getState() {
    return {
        logs: structuredClone(globalState.logs), // FIX #4: deep copy
        profile: globalState.profile ? structuredClone(globalState.profile) : null,
        uid: globalState.uid,
        isGuest: globalState.isGuest,
    };
}

// ─────────────────────────────────────────────
// 6. DISPATCH FUNCTIONS (Mutations / Intents)
//    Pattern: snapshot → optimistic update → notify → cloud sync
//                                                    ↓ (on failure)
//                              restore snapshot → notify [rollback]
// ─────────────────────────────────────────────

/**
 * _snapshot: Take a deep clone of a single log entry for rollback purposes.
 * Returns null if the entry doesn't exist (for restore-on-failure case).
 */
function _snapshot(dateKey) {
    return globalState.logs[dateKey]
        ? structuredClone(globalState.logs[dateKey])
        : null; // null = "did not exist before"
}

/**
 * _rollback: Restore a log entry to its pre-mutation state and re-notify UI.
 * FIX #2: Called in every dispatch catch() block.
 * @param {string} dateKey
 * @param {object|null} snapshot - The pre-mutation value (null = delete the key)
 */
function _rollback(dateKey, snapshot) {
    if (snapshot === null) {
        delete globalState.logs[dateKey];
    } else {
        globalState.logs[dateKey] = snapshot;
    }
    notify('logsUpdated');
    console.warn(`State: Rolled back optimistic update for ${dateKey}.`);
}

/**
 * Update the status or note for a specific day.
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {{ status?: string, note?: string }} payload
 */
export async function dispatchUpdateDay(dateKey, payload) {
    if (globalState.isGuest || !globalState.uid) {
        console.warn('State: dispatchUpdateDay blocked — Guest Mode.');
        return;
    }

    const { status, note } = payload;
    const uid = globalState.uid;
    const snap = _snapshot(dateKey); // FIX #2: capture pre-mutation state

    // Optimistic local update
    if (!globalState.logs[dateKey]) globalState.logs[dateKey] = {};
    if (status !== undefined) globalState.logs[dateKey].status = status;
    if (note !== undefined) globalState.logs[dateKey].note = note;
    globalState.logs[dateKey].updatedAt = new Date().toISOString();
    notify('logsUpdated');

    try {
        await updateDayLog(uid, dateKey, status, note, globalState.logs[dateKey]?.inTrash ?? false);
    } catch (e) {
        console.error(`State: Cloud sync failed for ${dateKey}:`, e);
        _rollback(dateKey, snap); // FIX #2: revert on failure
    }
}

/**
 * Move a day log to Trash (soft delete).
 * @param {string} dateKey - "YYYY-MM-DD"
 */
export async function dispatchMoveToTrash(dateKey) {
    if (globalState.isGuest || !globalState.uid) return;
    const uid = globalState.uid;
    const snap = _snapshot(dateKey); // FIX #2

    if (!globalState.logs[dateKey]) globalState.logs[dateKey] = {};
    globalState.logs[dateKey].inTrash = true;
    globalState.logs[dateKey].deletedAt = new Date().toISOString();
    notify('logsUpdated');

    try {
        await updateInTrash(uid, dateKey, true);
    } catch (e) {
        console.error(`State: Trash sync failed for ${dateKey}:`, e);
        _rollback(dateKey, snap); // FIX #2
    }
}

/**
 * Restore a day log from Trash.
 * @param {string} dateKey - "YYYY-MM-DD"
 */
export async function dispatchRestoreFromTrash(dateKey) {
    if (globalState.isGuest || !globalState.uid) return;
    const uid = globalState.uid;
    const snap = _snapshot(dateKey); // FIX #2

    if (globalState.logs[dateKey]) {
        globalState.logs[dateKey].inTrash = false;
        delete globalState.logs[dateKey].deletedAt;
    }
    notify('logsUpdated');

    try {
        await updateInTrash(uid, dateKey, false);
    } catch (e) {
        console.error(`State: Restore sync failed for ${dateKey}:`, e);
        _rollback(dateKey, snap); // FIX #2
    }
}

/**
 * Permanently delete a day log (hard delete).
 * @param {string} dateKey - "YYYY-MM-DD"
 */
export async function dispatchDeleteDay(dateKey) {
    if (globalState.isGuest || !globalState.uid) return;
    const uid = globalState.uid;
    const snap = _snapshot(dateKey); // FIX #2

    delete globalState.logs[dateKey];
    notify('logsUpdated');

    try {
        await deleteDayLog(uid, dateKey);
    } catch (e) {
        console.error(`State: Hard delete sync failed for ${dateKey}:`, e);
        _rollback(dateKey, snap); // FIX #2 — re-inserts the deleted entry
    }
}

/**
 * Save user profile data.
 * @param {Object} profileData - { firstName, lastName, marketingConsent, ... }
 */
export async function dispatchSaveProfile(profileData) {
    if (globalState.isGuest || !globalState.uid) return;
    const uid = globalState.uid;
    const snapProfile = globalState.profile ? structuredClone(globalState.profile) : null;

    globalState.profile = { ...globalState.profile, ...profileData };
    notify('profileUpdated');

    try {
        await saveUserProfile(uid, profileData);
    } catch (e) {
        console.error('State: Profile save sync failed:', e);
        // FIX #2: Roll back profile to pre-mutation state
        globalState.profile = snapProfile;
        notify('profileUpdated');
        console.warn('State: Profile rolled back to pre-save state.');
    }
}
