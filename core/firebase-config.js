/**
 * core/firebase-config.js
 * ROLE: The "Engine" - Initializes Firebase and exports the Auth instance.
 * Using Firebase v10+ Modular SDK.
 */

import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase Web SDK requires the routing configuration to be publicly accessible in the browser.
// True security lies in our strict Firestore Rules, not in hiding these routing IDs.
const firebaseConfig = {
    apiKey: "AIzaSyCwh87M2yq4v45MzTsT6ak-el5zJ6-mJMs",
    authDomain: "focushub-db.firebaseapp.com",
    projectId: "focushub-db",
    storageBucket: "focushub-db.firebasestorage.app",
    messagingSenderId: "419527223079",
    appId: "1:419527223079:web:87ca93a46e03a8cd43ab02",
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
        db = getFirestore(app);

        // Ensure session persistence is set to local (survives tab close).
        // Single call here — do NOT call setPersistence again in auth.js.
        setPersistence(auth, browserLocalPersistence)
            .catch((error) => {
                console.error("Auth persistence error:", error);
            });

    } else {
        console.warn("Firebase is not initialized due to missing credentials.");
    }
} catch (error) {
    console.error("Firebase Initialization Error:", error);
}

export { auth, db };
