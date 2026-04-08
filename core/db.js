/**
 * core/db.js
 * ROLE: Isolated module for all Firestore operations.
 * Schema: users_progress/{uid} -> { logs: { "YYYY-MM-DD": "completed" } }
 */

import { db, auth } from "./firebase-config.js";
export { db, auth };
import { 
    doc, 
    setDoc, 
    getDoc,
    updateDoc,
    deleteField
} from "firebase/firestore";

/**
 * ⚡ IN-MEMORY CACHE (Production-Grade Rate Limiting)
 * Eliminates redundant Firestore billing and network latency when navigating between modules.
 */
export let IN_MEMORY_CACHE = {
    progress: null,
    profile: null,
    uid: null
};

export function invalidateCache() {
    IN_MEMORY_CACHE = { progress: null, profile: null, uid: null };
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

/**
 * Update the status for a specific date.
 * @param {string} uid - User ID
 * @param {string} dateKey - The date key in YYYY-MM-DD format
 * @param {string} status - 'completed', 'skipped', or 'pending'
 */
export async function updateDateStatus(uid, dateKey, status) {
    return updateDayLog(uid, dateKey, status, undefined, false);
}

/**
 * Update the note for a specific date.
 * @param {string} uid - User ID
 * @param {string} dateKey - The date key in YYYY-MM-DD format
 * @param {string} note - The user's note
 */
export async function updateDateNote(uid, dateKey, note) {
    return updateDayLog(uid, dateKey, undefined, note, false);
}

/**
 * Update both status and note for a specific date.
 * @param {string} uid - User ID
 * @param {string} dateKey - The date key in YYYY-MM-DD format
 * @param {string} status - 'completed', 'skipped', or 'pending'
 * @param {string} note - The user's note
 */
/**
 * Update both status and note for a specific date.
 * @param {string} uid - User ID
 * @param {string} dateKey - The date key in YYYY-MM-DD format
 * @param {string} status - 'completed', 'skipped', or 'pending'
 * @param {string} note - The user's note
 */
export async function updateDayLog(uid, dateKey, status, note, inTrash = false) {
    if (!uid || !dateKey) return;

    const docRef = doc(db, "users_progress", uid);
    const path = `users_progress/${uid}`;
    
    try {
        // Enforce 500-character limit for notes
        if (note && note.length > 500) {
            throw new Error("Note exceeds 500 characters limit.");
        }

        // We use updateDoc with dot notation for precise merging.
        // But first we must ensure the document exists.
        // Read from cache if possible to save database quota
        let docExists = false;
        let existingLog = null;
        
        if (IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.progress !== null) {
            // If cache exists, the document exists
            docExists = true;
            existingLog = IN_MEMORY_CACHE.progress[dateKey];
        } else {
            // Uncached, so query
            const docSnap = await getDocWithTimeout(docRef);
            docExists = docSnap.exists();
            if (docExists) {
                existingLog = docSnap.data().logs?.[dateKey];
            }
        }
        
        // Prevent phantom database writes if nothing actually changed
        if (existingLog && typeof existingLog !== 'string') {
            let hasChanges = false;
            if (status !== undefined && existingLog.status !== status) hasChanges = true;
            if (note !== undefined && existingLog.note !== note) hasChanges = true;
            if (inTrash !== undefined && existingLog.inTrash !== inTrash) hasChanges = true;

            if (!hasChanges) {
                console.log(`⚡ Phantom Write Prevented: No changes for ${dateKey}`);
                return; // Nothing changed, skip completely
            }
        }
        
        if (!docExists) {
            // Create initial document
            await setDoc(docRef, { 
                logs: { 
                    [dateKey]: { 
                        status: status || 'pending', 
                        note: note || '', 
                        inTrash: inTrash || false,
                        deletedAt: inTrash ? new Date().toISOString() : null,
                        updatedAt: new Date().toISOString()
                    } 
                } 
            });
            // Update Cache
            if (IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.progress) {
                IN_MEMORY_CACHE.progress[dateKey] = { status: status || 'pending', note: note || '', inTrash: inTrash || false };
            }
        } else {
            const updateData = {};
            
            // If existing log is a string (old format), we must overwrite it with an object
            if (typeof existingLog === 'string') {
                updateData[`logs.${dateKey}`] = {
                    status: status !== undefined ? status : existingLog,
                    note: note !== undefined ? note : '',
                    inTrash: inTrash !== undefined ? inTrash : false,
                    deletedAt: inTrash === true ? new Date().toISOString() : null,
                    updatedAt: new Date().toISOString()
                };
            } else {
                // Standard nested update using dot notation for safety
                if (status !== undefined) updateData[`logs.${dateKey}.status`] = status;
                if (note !== undefined) updateData[`logs.${dateKey}.note`] = note;
                
                if (inTrash !== undefined) {
                    updateData[`logs.${dateKey}.inTrash`] = inTrash;
                    if (inTrash === true) {
                        updateData[`logs.${dateKey}.deletedAt`] = new Date().toISOString();
                    } else {
                        // If restoring, clear the deletedAt field
                        updateData[`logs.${dateKey}.deletedAt`] = deleteField();
                    }
                }
                
                updateData[`logs.${dateKey}.updatedAt`] = new Date().toISOString();
            }
            
            await updateDoc(docRef, updateData);
            
            // Sync cache to remain fresh
            if (IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.progress) {
                if (typeof existingLog === 'string') {
                    IN_MEMORY_CACHE.progress[dateKey] = {
                        status: status !== undefined ? status : existingLog,
                        note: note !== undefined ? note : '',
                        inTrash: inTrash !== undefined ? inTrash : false
                    };
                } else {
                    if (!IN_MEMORY_CACHE.progress[dateKey]) IN_MEMORY_CACHE.progress[dateKey] = {};
                    if (status !== undefined) IN_MEMORY_CACHE.progress[dateKey].status = status;
                    if (note !== undefined) IN_MEMORY_CACHE.progress[dateKey].note = note;
                    if (inTrash !== undefined) IN_MEMORY_CACHE.progress[dateKey].inTrash = inTrash;
                }
            }
        }
        
        console.log(`Cloud Sync: Updated ${dateKey} (status: ${status}, inTrash: ${inTrash})`);
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
    }
}

/**
 * Specifically update the inTrash status for a date.
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
 * Load all progress data for a user.
 * Includes a migration step to fix corrupted dot-notation fields.
 * @param {string} uid - User ID
 * @returns {Object} - The logs map from Firestore
 */
export async function loadProgress(uid, forceRefresh = false) {
    if (!uid) return {};

    if (!forceRefresh && IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.progress !== null) {
        console.log("⚡ Network Saved: Returning logs from cache.");
        return IN_MEMORY_CACHE.progress;
    }

    const docRef = doc(db, "users_progress", uid);
    const path = `users_progress/${uid}`;
    
    try {
        const docSnap = await getDocWithTimeout(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const logs = data.logs || {};
            
            // Migration: Check for corrupted root-level fields starting with "logs."
            // These were created by a previous bug using setDoc with dot-notation keys.
            const corruptedKeys = Object.keys(data).filter(k => k.startsWith('logs.'));
            if (corruptedKeys.length > 0) {
                console.warn(`Data Migration: Found ${corruptedKeys.length} corrupted fields. Repairing...`);
                const repairData = {};
                const deleteData = {};
                
                corruptedKeys.forEach(key => {
                    // key is like "logs.2024-01-01.status"
                    const parts = key.split('.');
                    if (parts.length >= 3) {
                        const date = parts[1];
                        const field = parts[2];
                        
                        if (!logs[date]) logs[date] = {};
                        if (typeof logs[date] === 'string') {
                            // Convert old string format to object
                            logs[date] = { status: logs[date] };
                        }
                        
                        logs[date][field] = data[key];
                        deleteData[key] = deleteField();
                    }
                });
                
                // Save repaired logs and delete corrupted fields
                await updateDoc(docRef, { ...deleteData, logs: logs });
                console.log("Data Migration: Repair complete.");
            }
            
            IN_MEMORY_CACHE.uid = uid;
            IN_MEMORY_CACHE.progress = logs;
            return logs;
        } else {
            IN_MEMORY_CACHE.uid = uid;
            IN_MEMORY_CACHE.progress = {};
            return {};
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
    }
    return {};
}

/**
 * Permanently delete a log entry for a specific date.
 * @param {string} uid - User ID
 * @param {string} dateKey - The date key in YYYY-MM-DD format
 */
export async function deleteDayLog(uid, dateKey) {
    if (!uid || !dateKey) return;

    const docRef = doc(db, "users_progress", uid);
    const path = `users_progress/${uid}`;
    
    try {
        const updateData = {};
        updateData[`logs.${dateKey}`] = deleteField();
        
        await updateDoc(docRef, updateData);
        
        if (IN_MEMORY_CACHE.uid === uid && IN_MEMORY_CACHE.progress) {
            delete IN_MEMORY_CACHE.progress[dateKey];
        }
        
        console.log(`Cloud Sync: Permanently deleted log for ${dateKey}`);
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
    }
}
