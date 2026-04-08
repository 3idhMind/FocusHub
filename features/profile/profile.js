/**
 * features/profile/profile.js
 * Logic for the user profile section.
 */

import { auth } from '../../core/firebase-config.js';
import { getUserProfile } from '../../core/db.js';

export async function init() {
    console.log("Profile feature initialized");
    
    // Bind to the auth change event so the profile updates dynamically
    window.addEventListener('authChanged', (e) => {
        renderProfile(e.detail.user);
    });

    // Render immediately if auth state is already known
    const currentUser = auth.currentUser;
    renderProfile(currentUser);
}

async function renderProfile(user) {
    const nameDisplay = document.getElementById('profile-name-display');
    const emailDisplay = document.getElementById('profile-email-display');
    const avatarDisplay = document.getElementById('profile-avatar-display');
    const statusDot = document.getElementById('profile-status-dot');
    const statusText = document.getElementById('profile-status-text');
    const guestActions = document.getElementById('profile-guest-actions');
    const userActions = document.getElementById('profile-user-actions');

    if (!nameDisplay) return; // Feature might not be in DOM yet

    if (user) {
        // Optimistic UI Update: Show known data immediately to prevent "Guest" flash
        let displayName = user.displayName;
        nameDisplay.innerText = displayName || "Loading Profile...";
        emailDisplay.innerText = user.email;
        avatarDisplay.innerText = (displayName || "L").charAt(0).toUpperCase();

        statusDot.className = 'status-indicator online';
        statusText.innerText = "Active - Your progress is safely synced to the cloud";

        guestActions.classList.add('hidden');
        userActions.classList.remove('hidden');

        // Fetch detailed profile from Firestore
        try {
            const userProfile = await getUserProfile(user.uid);
            if (userProfile && userProfile.firstName) {
                displayName = `${userProfile.firstName} ${userProfile.lastName || ''}`.trim();
                // Update with full names once loaded
                nameDisplay.innerText = displayName;
                avatarDisplay.innerText = (displayName).charAt(0).toUpperCase();
            }
        } catch(e) {
            console.error("Could not fetch user profile details", e);
            nameDisplay.innerText = displayName || "FocusHub User";
        }

    } else {
        nameDisplay.innerText = "Guest User";
        emailDisplay.innerText = "Not logged in";
        avatarDisplay.innerText = "G";

        statusDot.className = 'status-indicator offline';
        statusText.innerText = "Guest Mode - Progress is completely local and not backed up";

        guestActions.classList.remove('hidden');
        userActions.classList.add('hidden');
    }
}
