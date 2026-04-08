/**
 * core/firebase-config.js
 * ROLE: The "Engine" - Initializes Firebase and exports the Auth instance.
 * Using Firebase v10+ Modular SDK.
 */

import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore, doc, getDocFromCache, getDocFromServer } from "firebase/firestore";

// Import the Firebase configuration from environment variables
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID
};

// Check if critical config is missing
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.error("Firebase Configuration is missing! Please add VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID to your environment variables in the Settings menu.");
}

// Initialize Firebase App
let app;
let auth;
let db;

try {
    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        
        // Safety Check: If firestoreDatabaseId looks like a Measurement ID (starts with G-), 
        // it's likely a configuration error. We'll fallback to the default database.
        const dbId = firebaseConfig.firestoreDatabaseId;
        const isLikelyMeasurementId = dbId && dbId.startsWith('G-');
        
        if (isLikelyMeasurementId) {
            console.warn(`Firebase Config Warning: VITE_FIREBASE_FIRESTORE_DATABASE_ID is set to '${dbId}', which looks like a Measurement ID (Analytics), not a Firestore Database ID. Falling back to the default database to prevent slowness.`);
            db = getFirestore(app);
        } else if (dbId && dbId.trim() !== "" && dbId !== "(default)") {
            console.log(`Initializing Firestore with custom database ID: ${dbId}`);
            db = getFirestore(app, dbId);
        } else {
            console.log("Initializing Firestore with default database.");
            db = getFirestore(app);
        }
            
        // Ensure session persistence is set to local (survives tab close)
        setPersistence(auth, browserLocalPersistence)
            .catch((error) => {
                console.error("Auth persistence error:", error);
            });
            
        // Validate Connection to Firestore (CRITICAL CONSTRAINT)
        // We run this in the background to avoid blocking the main thread
        setTimeout(() => testConnection(db), 1000);
    } else {
        console.warn("Firebase is not initialized due to missing credentials. Please check your environment variables.");
    }
} catch (error) {
    console.error("Firebase Initialization Error:", error);
}

// Validate Connection to Firestore (CRITICAL CONSTRAINT)
async function testConnection(firestoreDb) {
    if (!firestoreDb) return;
    const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
    try {
        console.log(`Testing connection to Firestore database: ${dbId}...`);
        // Use getDocFromServer to force a network check
        await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
        console.log(`Firestore connection to '${dbId}' verified.`);
    } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error(`CRITICAL: Firestore connection failed for database '${dbId}'. The client is offline. This usually means the Database ID is incorrect or the database does not exist.`);
        } else if (error instanceof Error && error.message.includes('not-found')) {
            // This is actually a good sign - it means we connected but the test doc doesn't exist
            console.log(`Firestore connection to '${dbId}' verified (test document not found, which is expected).`);
        } else {
            console.warn(`Firestore connection test for '${dbId}' resulted in:`, error.message);
        }
    }
}

export { auth, db };
