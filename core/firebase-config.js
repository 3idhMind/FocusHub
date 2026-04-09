/**
 * core/firebase-config.js
 * ROLE: The "Engine" - Initializes Firebase and exports the Auth instance.
 * Using Firebase v10+ Modular SDK.
 */

import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore, doc, getDocFromCache, getDocFromServer } from "firebase/firestore";

// Firebase Web SDK requires the routing configuration to be publicly accessible in the browser.
// True security lies in our strict Firestore Rules, not in hiding these routing IDs.
// Note: Replace these placeholders with your actual Firebase config strings.
const firebaseConfig = {
    apiKey: "AIzaSyCwh87M2yq4v45MzTsT6ak-el5zJ6-mJMs",
    authDomain: "focushub-db.firebaseapp.com",
    projectId: "focushub-db",
    storageBucket: "focushub-db.firebasestorage.app",
    messagingSenderId: "419527223079",
    appId: "1:419527223079:web:87ca93a46e03a8cd43ab02",
    firestoreDatabaseId: "(default)"
};

// Check if critical config is missing
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
    console.error("Firebase Configuration is missing! Please paste your actual keys into firebase-config.js");
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
