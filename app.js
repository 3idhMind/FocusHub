import { initAuth } from "./core/auth.js";
import { initRouter } from "./core/router.js";
import { initState, onAuthChange } from "./core/state.js";

/**
 * FocusHub Entry Point — Auth-First Gatekeeper Pattern
 *
 * INITIALIZATION SEQUENCE (strict order, no exceptions):
 *   1. DOM Ready
 *   2. Firebase Auth resolves (onAuthStateChanged fires once)
 *   3. State Manager hydrates with confirmed user data
 *   4. Router boots and renders the default module
 *
 * All Firestore access flows through state.js dispatch functions.
 * No UI module ever calls db.js directly.
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log("FocusHub: DOM ready. Awaiting Auth gate...");
    initAuth(onAuthResolved, onSubsequentAuthChange);
});

/**
 * onAuthResolved — fires ONCE on boot when Firebase confirms the auth state.
 * This is the master unlock. State Manager hydrates BEFORE the router renders.
 * @param {import('firebase/auth').User | null} user
 */
async function onAuthResolved(user) {
    console.log(user
        ? `FocusHub: Auth gate OPEN. UID=${user.uid}. Hydrating state...`
        : "FocusHub: Auth gate OPEN (Guest). Booting in local-only mode..."
    );

    // Step 3: Hydrate the Brain BEFORE the router renders anything
    await initState(user);

    // Step 4: Router boots — all modules can now safely call getState()
    initRouter();
}

/**
 * onSubsequentAuthChange — fires on every login/logout AFTER the initial boot.
 * Re-hydrates the Brain with the new user's data without re-booting the router.
 * @param {import('firebase/auth').User | null} user
 */
async function onSubsequentAuthChange(user) {
    console.log("FocusHub: Auth state changed post-boot. Re-hydrating state...");
    await onAuthChange(user);
}

/**
 * Global UI Helpers (DOM interaction only — no Firebase)
 */
window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
};
