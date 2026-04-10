/**
 * core/db.js
 * ROLE: Isolated module for all Firestore operations.
 *
 * SCHEMA (v2 — Yearly Bucket):
 *   users/{uid}                          → Identity Layer: { email, username, createdAt }
 *   users/{uid}/tracker_data/{year}      → Yearly Bucket:  { logs: { "YYYY-MM-DD": {...} } }
 */


import { db, auth } from "./firebase-config.js";
export { db, auth };
import { 
    doc, 
    setDoc, 
    getDoc,
    updateDoc,
    deleteField,
    serverTimestamp
} from "firebase/firestore";


/**
 * ⚡ IN-MEMORY CACHE (Production-Grade Rate Limiting)
 *
 * v2 Schema: Cache is keyed by year, not a single flat blob.
 * This means navigating to a past year only costs 1 read ever (per session).
 * Structure: { uid: string|null, years: { "2026": {...logs}, "2025": {...logs} } }
 */
export let IN_MEMORY_CACHE = {
    uid: null,
    profile: null,
    years: {}   // { [year]: { [dateKey]: logObject } }
};

/** Wipe the entire cache on logout / auth change. */
export function invalidateCache() {
    IN_MEMORY_CACHE = { uid: null, profile: null, years: {} };
    console.log('DB Cache: Invalidated.');
}

/** Internal: get cached logs for a specific year (or null if uncached). */
function _getCachedYear(uid, year) {
    if (IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.years[year] !== undefined) {
        return IN_MEMORY_CACHE.years[year];
    }
    return null;
}

/** Internal: set cached logs for a specific year. */
function _setCachedYear(uid, year, logs) {
    IN_MEMORY_CACHE.uid = uid;
    IN_MEMORY_CACHE.years[year] = logs;
}

/** Internal: extract the year string from a YYYY-MM-DD dateKey. */
function _yearOf(dateKey) {
    return dateKey.split('-')[0]; // "2026-04-10" → "2026"
}

/**
 * AUTH GUARD — The DB-level firewall.
 * Every public data function calls this first.
 * If the user is not authenticated, it throws a clean, descriptive error
 * instead of sending a guaranteed-to-fail request to Firestore.
 * This is the second line of defense after the Auth-First Gatekeeper in app.js.
 */
function requireAuth(uid) {
    if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
        const reason = !uid ? 'No UID provided'
            : !auth.currentUser ? 'Firebase Auth not yet resolved (Guest Mode)'
            : 'UID mismatch (security violation)';
        console.warn(`DB Guard: Blocked Firestore call. Reason: ${reason}`);
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────
// PART 1 — IDENTITY LAYER
// ─────────────────────────────────────────────

/**
 * generateUsername — Creates a random display handle.
 * Format: "user_" + 6 random alphanumeric characters (e.g., "user_k7m2xp")
 * Collision probability at 10k users: ~0.0015% — acceptable for a display handle.
 * @returns {string}
 */
function generateUsername() {
    return 'user_' + Math.random().toString(36).slice(2, 8);
}

/**
 * initUserProfile — Safe, idempotent profile bootstrapper.
 *
 * RULE: This function is the ONLY place a users/{uid} document is created.
 *       It MUST run before getUserProfile() in the hydration sequence.
 *
 * Logic:
 *   1. Check if users/{uid} exists.
 *   2. If NOT exists → setDoc to create the canonical profile document.
 *   3. If EXISTS    → Backfill any missing fields (username, createdAt)
 *                     that may be absent on accounts created before schema v2.
 *                     Never overwrites existing data.
 *
 * @param {import('firebase/auth').User} userAuth - The confirmed Firebase Auth user object.
 */
export async function initUserProfile(userAuth) {
    if (!userAuth?.uid) return;
    if (!requireAuth(userAuth.uid)) return;

    const docRef = doc(db, 'users', userAuth.uid);

    try {
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            // ── NEW USER: Create the canonical profile document ──
            await setDoc(docRef, {
                email:     userAuth.email,
                username:  generateUsername(),
                createdAt: serverTimestamp(),
            });
            console.log(`Identity: Profile created for UID: ${userAuth.uid}`);

        } else {
            // ── EXISTING USER: Backfill missing v2 schema fields only ──
            const data = docSnap.data();
            const missing = {};
            if (!data.username)  missing.username  = generateUsername();
            if (!data.createdAt) missing.createdAt = serverTimestamp();

            if (Object.keys(missing).length > 0) {
                // updateDoc preserves all existing fields — no overwrite risk
                await updateDoc(docRef, missing);
                console.log(`Identity: Backfilled missing fields for UID: ${userAuth.uid}`, Object.keys(missing));
            } else {
                console.log(`Identity: Profile already up-to-date for UID: ${userAuth.uid}`);
            }
        }
    } catch (error) {
        // ISOLATION: Do NOT rethrow. A failure here (network blip, rules mismatch)
        // must never block _hydrate from loading the user's logs and profile.
        // The profile document will be created/backfilled on the next successful login.
        console.warn(`Identity: initUserProfile failed (non-fatal). Will retry on next login.`, error.message);
    }
}


/**
 * Helper to fetch a document with a timeout.
 * Prevents the app from hanging indefinitely on broken connections.
 */
async function getDocWithTimeout(docRef, timeoutMs = 5000) {
    return Promise.race([
        getDoc(docRef),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Firestore operation timed out")), timeoutMs)
        )
    ]);
}

/**
 * Operation types for Firestore error reporting.
 */
const OperationType = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
};

/**
 * Standardized Firestore error handler to provide context for permission issues.
 * @param {Error} error - The caught error
 * @param {string} operationType - The type of operation (from OperationType)
 * @param {string} path - The Firestore path being accessed
 */
function handleFirestoreError(error, operationType, path) {
    const errInfo = {
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
            userId: auth.currentUser?.uid || 'null',
            email: auth.currentUser?.email || 'null',
            emailVerified: auth.currentUser?.emailVerified || false,
            isAnonymous: auth.currentUser?.isAnonymous || false,
            tenantId: auth.currentUser?.tenantId || 'null',
            providerInfo: auth.currentUser?.providerData.map(provider => ({
                providerId: provider.providerId,
                displayName: provider.displayName,
                email: provider.email,
                photoUrl: provider.photoURL
            })) || []
        },
        operationType,
        path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
}

// ─────────────────────────────────────────────
// PART 2 — YEARLY BUCKET ENGINE
//   Path: users/{uid}/tracker_data/{year}
//   All writes use atomic dot-notation updateDoc.
// ─────────────────────────────────────────────

/**
 * _getYearDocRef — Returns the Firestore reference for a year bucket.
 * @param {string} uid
 * @param {string} year - e.g. "2026"
 */
function _getYearDocRef(uid, year) {
    return doc(db, 'users', uid, 'tracker_data', year);
}

/**
 * updateDateStatus — Convenience wrapper, kept for legacy compat.
 */
export async function updateDateStatus(uid, dateKey, status) {
    if (!requireAuth(uid)) return;
    return updateDayLog(uid, dateKey, status, undefined, false);
}

/**
 * updateDateNote — Convenience wrapper, kept for legacy compat.
 */
export async function updateDateNote(uid, dateKey, note) {
    if (!requireAuth(uid)) return;
    return updateDayLog(uid, dateKey, undefined, note, false);
}

/**
 * updateDayLog — Atomic write to the Yearly Bucket.
 *
 * CONCURRENCY SAFETY RULES (must never be broken):
 *   1. ALL updates use `updateDoc` with dot-notation → only the target field is touched.
 *   2. If the year document doesn't exist yet (first log of that year), `updateDoc`
 *      throws a "not-found" error. We catch it and use `setDoc` with `{merge:true}`
 *      to create the bucket safely. This is the ONLY place `setDoc` is used for logs.
 *   3. NEVER call `setDoc` on an existing year document — doing so replaces ALL logs.
 *
 * @param {string} uid
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {string|undefined} status
 * @param {string|undefined} note
 * @param {boolean} inTrash
 */
export async function updateDayLog(uid, dateKey, status, note, inTrash = false) {
    if (!uid || !dateKey) return;
    if (!requireAuth(uid)) return;

    // Note validation
    if (note && note.length > 500) {
        throw new Error('Note exceeds 500 characters limit.');
    }

    const year    = _yearOf(dateKey);            // "2026"
    const docRef  = _getYearDocRef(uid, year);  // users/{uid}/tracker_data/2026
    const path    = `users/${uid}/tracker_data/${year}`;

    // ── Phantom Write Guard ──────────────────────────────────────────────────
    // Skip if nothing actually changed (reads from cache — zero network cost).
    const cached = _getCachedYear(uid, year);
    if (cached) {
        const existing = cached[dateKey];
        if (existing && typeof existing === 'object') {
            let hasChanges = false;
            if (status !== undefined && existing.status !== status) hasChanges = true;
            if (note   !== undefined && existing.note   !== note)   hasChanges = true;
            if (inTrash !== undefined && existing.inTrash !== inTrash) hasChanges = true;
            if (!hasChanges) {
                console.log(`⚡ Phantom Write Prevented: No changes for ${dateKey}`);
                return;
            }
        }
    }

    // ── Build the atomic update payload ─────────────────────────────────────
    // Each key is a dot-notation path targeting ONLY the specific field.
    // Firestore guarantees other keys in the same document are untouched.
    const updatePayload = {};
    if (status  !== undefined) updatePayload[`logs.${dateKey}.status`]    = status;
    if (note    !== undefined) updatePayload[`logs.${dateKey}.note`]      = note;
    if (inTrash !== undefined) {
        updatePayload[`logs.${dateKey}.inTrash`] = inTrash;
        if (inTrash === true) {
            updatePayload[`logs.${dateKey}.deletedAt`] = new Date().toISOString();
        } else {
            updatePayload[`logs.${dateKey}.deletedAt`] = deleteField();
        }
    }
    updatePayload[`logs.${dateKey}.updatedAt`] = new Date().toISOString();

    try {
        // ── PRIMARY PATH: Atomic updateDoc ───────────────────────────────────
        await updateDoc(docRef, updatePayload);

    } catch (firstWriteError) {
        // ── FALLBACK PATH: First log of this year (doc doesn't exist yet) ────
        // updateDoc throws 'not-found' when the year bucket has never been created.
        // We bootstrap the document safely with setDoc + merge:true.
        // merge:true means: create if absent, merge if present — never overwrites.
        if (firstWriteError?.code === 'not-found') {
            try {
                const bootstrapPayload = {
                    logs: {
                        [dateKey]: {
                            status:    status    !== undefined ? status    : 'pending',
                            note:      note      !== undefined ? note      : '',
                            inTrash:   inTrash   !== undefined ? inTrash   : false,
                            deletedAt: inTrash === true ? new Date().toISOString() : null,
                            updatedAt: new Date().toISOString(),
                        }
                    }
                };
                await setDoc(docRef, bootstrapPayload, { merge: true });
                console.log(`DB: Bootstrapped new year bucket [${year}] for UID: ${uid}`);
            } catch (bootstrapError) {
                handleFirestoreError(bootstrapError, OperationType.WRITE, path);
                return;
            }
        } else {
            // Any other error (permissions, network) — surface it normally
            handleFirestoreError(firstWriteError, OperationType.WRITE, path);
            return;
        }
    }

    // ── Sync in-memory cache ─────────────────────────────────────────────────
    const yearCache = _getCachedYear(uid, year) || {};
    if (!yearCache[dateKey]) yearCache[dateKey] = {};
    if (status  !== undefined) yearCache[dateKey].status  = status;
    if (note    !== undefined) yearCache[dateKey].note    = note;
    if (inTrash !== undefined) yearCache[dateKey].inTrash = inTrash;
    if (inTrash === true)  yearCache[dateKey].deletedAt = new Date().toISOString();
    if (inTrash === false) delete yearCache[dateKey].deletedAt;
    _setCachedYear(uid, year, yearCache);

    console.log(`Cloud Sync ✓ [${year}] ${dateKey} — status: ${status}, inTrash: ${inTrash}`);
}

/**
 * updateInTrash — Soft-delete or restore a day's log.
 * Thin wrapper over updateDayLog to preserve state.js call signature.
 */
export async function updateInTrash(uid, dateKey, inTrash) {
    return updateDayLog(uid, dateKey, undefined, undefined, inTrash);
}


/**
 * Load user profile data from Firestore.
 * @param {string} uid - User ID
 * @returns {Object|null} - The user profile data or null
 */
export async function getUserProfile(uid, forceRefresh = false) {
    if (!uid) return null;
    if (!requireAuth(uid)) return null;

    if (!forceRefresh && IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.profile !== null) {
        return IN_MEMORY_CACHE.profile;
    }

    const docRef = doc(db, "users", uid);
    const path = `users/${uid}`;
    
    try {
        const docSnap = await getDocWithTimeout(docRef);
        if (docSnap.exists()) {
            IN_MEMORY_CACHE.uid = uid;
            IN_MEMORY_CACHE.profile = docSnap.data();
            return IN_MEMORY_CACHE.profile;
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
    }
    return null;
}

/**
 * Save user profile data to Firestore.
 * @param {string} uid - User ID
 * @param {Object} profileData - { firstName, lastName, email, marketingConsent }
 */
export async function saveUserProfile(uid, profileData) {
    if (!uid) return;
    if (!requireAuth(uid)) return;

    const docRef = doc(db, "users", uid);
    const path = `users/${uid}`;
    
    try {
        await setDoc(docRef, {
            ...profileData,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        // Update cache instantly
        if (IN_MEMORY_CACHE.uid === uid) {
            IN_MEMORY_CACHE.profile = { ...IN_MEMORY_CACHE.profile, ...profileData };
        }
        
        console.log("User profile saved to Firestore and Memory cache.");
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
    }
}

/**
 * loadProgress — Load all logs for a specific year from the Yearly Bucket.
 *
 * v2 Schema: reads users/{uid}/tracker_data/{year}
 * Default year is the current calendar year.
 *
 * Cost Model: 1 document read per year per session.
 * Cached: subsequent calls for the same year return in-memory data (0 reads).
 *
 * @param {string} uid
 * @param {number|string} [year] - Defaults to current year
 * @param {boolean} [forceRefresh]
 * @returns {Object} - The logs map: { "YYYY-MM-DD": { status, note, inTrash, ... } }
 */
export async function loadProgress(uid, year = new Date().getFullYear(), forceRefresh = false) {
    if (!uid) return {};
    if (!requireAuth(uid)) return {};

    const yearStr = String(year);

    // ── Cache Hit ─────────────────────────────────────────────────────────────
    if (!forceRefresh) {
        const cached = _getCachedYear(uid, yearStr);
        if (cached !== null) {
            console.log(`⚡ Network Saved: Returning [${yearStr}] logs from cache.`);
            return cached;
        }
    }

    // ── Cache Miss: Fetch from Firestore ──────────────────────────────────────
    const docRef = _getYearDocRef(uid, yearStr);
    const path   = `users/${uid}/tracker_data/${yearStr}`;

    try {
        const docSnap = await getDocWithTimeout(docRef);
        if (docSnap.exists()) {
            const logs = docSnap.data().logs || {};
            _setCachedYear(uid, yearStr, logs);
            console.log(`DB: Loaded ${Object.keys(logs).length} logs for [${yearStr}].`);
            return logs;
        } else {
            // No data for this year yet — cache the empty result to prevent repeat reads.
            _setCachedYear(uid, yearStr, {});
            console.log(`DB: No data found for [${yearStr}]. Returning empty.`);
            return {};
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
    }
    return {};
}

/**
 * deleteDayLog — Permanently remove a single day's log from its year bucket.
 *
 * Uses atomic dot-notation deleteField() so only the target date key is removed.
 * All other dates in the same year document are untouched.
 *
 * @param {string} uid
 * @param {string} dateKey - "YYYY-MM-DD"
 */
export async function deleteDayLog(uid, dateKey) {
    if (!uid || !dateKey) return;
    if (!requireAuth(uid)) return;

    const year   = _yearOf(dateKey);
    const docRef = _getYearDocRef(uid, year);
    const path   = `users/${uid}/tracker_data/${year}`;

    try {
        // Atomic field-level delete — other dates in this year are safe
        await updateDoc(docRef, {
            [`logs.${dateKey}`]: deleteField()
        });

        // Remove from cache
        const yearCache = _getCachedYear(uid, year);
        if (yearCache) {
            delete yearCache[dateKey];
            _setCachedYear(uid, year, yearCache);
        }

        console.log(`Cloud Sync ✓ Permanently deleted log: ${dateKey}`);
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
    }
}
