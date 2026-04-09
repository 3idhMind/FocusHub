/**
 * features/profile/profile.js
 * ROLE: UI renderer for the Profile tab.
 *
 * ARCHITECTURE CONTRACT:
 *   - Reads from getState() — never directly from db.js or firebase-config.js
 *   - Subscribes to 'stateReady' and 'authChanged' events from the Brain
 *   - Profile Firestore data (firstName/lastName) is loaded by state.js during hydration
 */

import { getState, subscribe } from '../../core/state.js';

export function init() {
    console.log("Profile feature initialized");

    // Subscribe to Brain events — re-render on every auth state transition
    subscribe('stateReady', ({ uid, isGuest, profile }) => {
        renderProfile(uid, isGuest, profile);
    });

    subscribe('authChanged', ({ uid, isGuest }) => {
        const { profile } = getState();
        renderProfile(uid, isGuest, profile);
    });

    subscribe('profileUpdated', ({ profile, uid }) => {
        const { isGuest } = getState();
        renderProfile(uid, isGuest, profile);
    });

    // If state is already available (loaded before this module mounted), paint now
    const { uid, isGuest, profile } = getState();
    renderProfile(uid, isGuest, profile);
}

// onShow — called by router on every tab revisit (zero network cost)
export function onShow() {
    const { uid, isGuest, profile } = getState();
    renderProfile(uid, isGuest, profile);
}

function renderProfile(uid, isGuest, profile) {
    const nameDisplay = document.getElementById('profile-name-display');
    const emailDisplay = document.getElementById('profile-email-display');
    const avatarDisplay = document.getElementById('profile-avatar-display');
    const statusDot = document.getElementById('profile-status-dot');
    const statusText = document.getElementById('profile-status-text');
    const guestActions = document.getElementById('profile-guest-actions');
    const userActions = document.getElementById('profile-user-actions');

    if (!nameDisplay) return; // Feature DOM not mounted yet

    if (!isGuest && uid) {
        // Build display name from Firestore profile (hydrated by state.js)
        let displayName = 'FocusHub User';
        let emailStr = '';

        if (profile) {
            if (profile.firstName) {
                displayName = `${profile.firstName} ${profile.lastName || ''}`.trim();
            }
            if (profile.email) {
                emailStr = profile.email;
            }
        }

        nameDisplay.innerText = displayName;
        emailDisplay.innerText = emailStr || 'Authenticated User';
        avatarDisplay.innerText = displayName.charAt(0).toUpperCase();

        if (statusDot) statusDot.className = 'status-indicator online';
        if (statusText) statusText.innerText = 'Active — Your progress is safely synced to the cloud';

        if (guestActions) guestActions.classList.add('hidden');
        if (userActions) userActions.classList.remove('hidden');

    } else {
        // Guest Mode
        nameDisplay.innerText = 'Guest User';
        emailDisplay.innerText = 'Not logged in';
        avatarDisplay.innerText = 'G';

        if (statusDot) statusDot.className = 'status-indicator offline';
        if (statusText) statusText.innerText = 'Guest Mode — Progress is local only and not backed up';

        if (guestActions) guestActions.classList.remove('hidden');
        if (userActions) userActions.classList.add('hidden');
    }
}
