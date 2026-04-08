/**
 * core/auth.js
 * ROLE: Global state management & Guest mode logic.
 * Strictly Email/Password-only authentication flow.
 */

import { 
    auth 
} from "./firebase-config.js";

import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    sendPasswordResetEmail,
    updateProfile,
    setPersistence,
    browserLocalPersistence
} from "firebase/auth";

import { saveUserProfile, getUserProfile } from "./db.js";

// Global state variable
let currentUser = null;
let authMode = 'login'; // 'login' or 'signup'
let isSignupMode = false;

/**
 * Minimal Toast Notification System
 */
export function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    let displayMessage = message;
    
    // If it's a JSON string (from handleFirestoreError), parse it for a cleaner message
    if (typeof message === 'string' && message.startsWith('{') && message.endsWith('}')) {
        try {
            const errObj = JSON.parse(message);
            if (errObj.error) {
                displayMessage = `Security Error: ${errObj.error}`;
            }
        } catch (e) {
            // Not JSON, keep original
        }
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>⚠️</span> ${displayMessage}`;
    
    container.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Shake the modal on error
 */
function shakeModal() {
    const modalContent = document.querySelector('.modal-content');
    if (modalContent) {
        modalContent.classList.add('shake');
        setTimeout(() => modalContent.classList.remove('shake'), 400);
    }
}

/**
 * The Watchman: Global state listener
 */
export function initAuth() {
    // Ensure persistence is set to LOCAL
    setPersistence(auth, browserLocalPersistence).catch(err => console.error("Persistence Error:", err));

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        console.log(user ? "User Authenticated:" : "User in Guest Mode", user?.email || "");
        
        // Sync the UI based on the new state
        try {
            syncAuthStateUI();
        } catch (e) {
            console.error("UI Sync Error:", e);
        }
        
        // Dispatch custom event for features to react to auth changes
        window.dispatchEvent(new CustomEvent('authChanged', { detail: { user } }));
    });

    // Global Modal Click-Outside-to-Close listener
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            const modalId = e.target.id;
            if (modalId === 'auth-modal') {
                closeAuthModal();
            } else if (modalId === 'fear-popup') {
                closeFearPopup();
            } else if (modalId === 'diary-modal') {
                // Assuming tracker handles its own modal closing but we can add it here if needed
                if (window.tracker && window.tracker.closeDiary) {
                    window.tracker.closeDiary();
                } else {
                    e.target.classList.add('hidden');
                }
            } else {
                // Generic fallback
                e.target.classList.add('hidden');
            }
        }
    });
}

/**
 * syncAuthStateUI: Centralized UI state manager.
 */
export function syncAuthStateUI() {
    const user = currentUser;
    const banner = document.getElementById('guest-banner');
    const dashboardAddBtn = document.getElementById('dashboard-add-btn');
    
    if (user) {
        // AUTHENTICATED STATE
        if (banner) banner.classList.add('hidden');
        if (dashboardAddBtn) {
            dashboardAddBtn.classList.remove('locked');
            dashboardAddBtn.title = "Add new widget";
        }
        document.body.classList.add('user-logged-in');
        document.body.classList.remove('guest-mode');
    } else {
        // GUEST STATE
        if (banner) banner.classList.remove('hidden');
        if (dashboardAddBtn) {
            dashboardAddBtn.classList.add('locked');
            dashboardAddBtn.title = "Log in to add widgets";
        }
        document.body.classList.add('guest-mode');
        document.body.classList.remove('user-logged-in');
    }
}

/**
 * Handle User Login
 */
export async function handleLogin(email, password) {
    if (!auth) {
        showToast("Firebase is not initialized. Please check your environment variables.");
        return;
    }
    if (!email || !password) {
        shakeModal();
        showToast("Please enter both email and password.");
        return;
    }

    try {
        console.log("Attempting to log in user...");
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log("Login successful:", userCredential.user.uid);
        closeAuthModal();
        return userCredential.user;
    } catch (error) {
        console.error("Login Error:", error.code, error.message);
        shakeModal();
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            showToast("Invalid email or password.");
        } else if (error.code === 'auth/operation-not-allowed') {
            showToast("Email/Password login is not enabled in Firebase.");
        } else {
            showToast(error.message);
        }
        throw error;
    }
}

/**
 * Handle User Signup
 */
export async function handleSignup(email, password, confirmPassword, firstName, lastName, marketingConsent) {
    if (!auth) {
        showToast("Firebase is not initialized. Please check your environment variables.");
        return;
    }
    // Mandatory Field Validation
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
        shakeModal();
        showToast("All fields are mandatory.");
        return;
    }
    
    // Consent Validation (Mandatory)
    if (!marketingConsent) {
        shakeModal();
        showToast("Please accept the terms and conditions.");
        return;
    }

    // Password Match Validation
    if (password !== confirmPassword) {
        shakeModal();
        showToast("Passwords do not match.");
        return;
    }

    // Password Length Validation
    if (password.length < 6) {
        shakeModal();
        showToast("Password must be at least 6 characters.");
        return;
    }
    
    try {
        console.log("Attempting to create user in Firebase Auth...");
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("User created in Auth successfully:", user.uid);

        // Update Firebase Auth Profile
        console.log("Updating Auth profile...");
        await updateProfile(user, {
            displayName: `${firstName} ${lastName}`
        });

        // Create dedicated user document in Firestore
        console.log("Saving user profile to Firestore...");
        await saveUserProfile(user.uid, {
            firstName,
            lastName,
            email,
            marketingConsent
        });
        
        // Phase 4.2: Secure Contact Sync (Background Process)
        syncToBrevo(email, firstName, lastName);

        console.log("Signup process complete.");
        closeAuthModal();
        return user;
    } catch (error) {
        console.error("Signup Error:", error.code, error.message);
        shakeModal();
        if (error.code === 'auth/email-already-in-use') {
            showAccountExistsView();
        } else if (error.code === 'auth/invalid-email') {
            showToast("Please enter a valid email address.");
        } else {
            showToast(error.message);
        }
        throw error;
    }
}

/**
 * Show the "Account Exists" view within the auth modal.
 */
function showAccountExistsView() {
    const mainView = document.getElementById('auth-main-view');
    const resetView = document.getElementById('reset-password-view');
    const existsView = document.getElementById('account-exists-view');
    const modalTitle = document.getElementById('auth-title');
    const modalDesc = document.getElementById('auth-subtitle');

    mainView.classList.add('hidden');
    resetView.classList.add('hidden');
    existsView.classList.remove('hidden');
    
    // Hide the standard header since the exists view has its own
    if (modalTitle) modalTitle.style.display = 'none';
    if (modalDesc) modalDesc.style.display = 'none';
}

/**
 * Transition from "Account Exists" view to Login view.
 */
export function switchToLoginFromExists() {
    const mainView = document.getElementById('auth-main-view');
    const existsView = document.getElementById('account-exists-view');
    const modalTitle = document.getElementById('auth-title');
    const modalDesc = document.getElementById('auth-subtitle');

    existsView.classList.add('hidden');
    mainView.classList.remove('hidden');
    
    if (modalTitle) modalTitle.style.display = 'block';
    if (modalDesc) modalDesc.style.display = 'block';
    
    // Ensure we are in login mode
    if (isSignupMode) {
        toggleAuthMode();
    }
}

/**
 * Transition from "Account Exists" view back to Signup view.
 */
export function switchToSignupFromExists() {
    const mainView = document.getElementById('auth-main-view');
    const existsView = document.getElementById('account-exists-view');
    const modalTitle = document.getElementById('auth-title');
    const modalDesc = document.getElementById('auth-subtitle');

    existsView.classList.add('hidden');
    mainView.classList.remove('hidden');
    
    if (modalTitle) modalTitle.style.display = 'block';
    if (modalDesc) modalDesc.style.display = 'block';
    
    // Ensure we stay in signup mode (or switch back to it)
    if (!isSignupMode) {
        toggleAuthMode();
    }
    
    // Clear the email field so they can try a different one
    const emailInput = document.getElementById('auth-email');
    if (emailInput) {
        emailInput.value = '';
        emailInput.focus();
    }
}

/**
 * Handle Password Reset
 */
export async function handlePasswordReset(email) {
    if (!email) {
        shakeModal();
        showToast("Please enter your email address.");
        return;
    }
    
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Reset link sent! Check your inbox.");
        toggleAuthMode('login'); // Switch back to login after sending
    } catch (error) {
        shakeModal();
        showToast(error.message);
        throw error;
    }
}

/**
 * Background sync to Brevo via BFF Proxy
 */
async function syncToBrevo(email, firstName, lastName) {
    try {
        // Silent background fetch to our Vercel Serverless Function
        const response = await fetch('/api/sync-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, firstName, lastName })
        });
        
        if (!response.ok) {
            console.warn("Brevo Sync Warning: Failed to sync contact.");
        } else {
            console.log("Brevo Sync Success: User added to mailing list.");
        }
    } catch (err) {
        console.error("Brevo Sync Error (Network):", err);
    }
}

/**
 * Handle User Logout
 */
export async function handleLogout() {
    try {
        await signOut(auth);
        
        // Redirect to a safe view after logging out
        const defaultNav = document.querySelector('.nav-item[data-target="tool-365"]');
        if (defaultNav) defaultNav.click();
        
        // Hide popup if auth modal or any other is open
        closeAuthModal();
        
        showToast("Logged out successfully.");
    } catch (error) {
        showToast("Logout failed: " + error.message);
    }
}

/**
 * Auth UI Helpers
 */
export function openAuthModal(context = 'default') {
    const modal = document.getElementById('auth-modal');
    const subtitle = document.getElementById('auth-subtitle');
    
    if (context === 'fear') {
        subtitle.innerText = "Don't lose your progress. Secure your focus streak now.";
    } else if (context === 'dashboard') {
        subtitle.innerText = "Unlock the full potential. Log in to build your custom workspace.";
    } else {
        subtitle.innerText = "Log in to secure your progress and sync across devices.";
    }
    
    modal.classList.remove('hidden');
    const fearPopup = document.getElementById('fear-popup');
    if (fearPopup) fearPopup.classList.add('hidden');
}

export function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
}

export function toggleAuthMode(forceMode = null) {
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleText = document.getElementById('toggle-auth-text');
    const confirmInput = document.getElementById('auth-confirm-password');
    const nameFields = document.getElementById('auth-name-fields');
    const consentContainer = document.getElementById('auth-consent-container');
    const forgotContainer = document.getElementById('forgot-password-container');
    const mainView = document.getElementById('auth-main-view');
    const resetView = document.getElementById('reset-password-view');
    const existsView = document.getElementById('account-exists-view');
    
    // Ensure we are in main view and header is visible
    mainView.classList.remove('hidden');
    resetView.classList.add('hidden');
    if (existsView) existsView.classList.add('hidden');
    if (title) title.style.display = 'block';
    if (subtitle) subtitle.style.display = 'block';

    if (forceMode) {
        authMode = forceMode === 'login' ? 'signup' : 'login'; // Set it so the logic below flips it correctly
    }

    if (authMode === 'login') {
        authMode = 'signup';
        isSignupMode = true;
        title.innerHTML = "Focus<br>Create Account";
        subtitle.innerText = "Join Focus to secure your progress and sync across devices.";
        submitBtn.innerText = "Sign Up";
        toggleText.innerHTML = `Already have an account? <a href="#" onclick="auth.toggleAuthMode()">Log In</a>`;
        confirmInput.classList.remove('hidden');
        nameFields.classList.remove('hidden');
        consentContainer.classList.remove('hidden');
        forgotContainer.classList.add('hidden');
    } else {
        authMode = 'login';
        isSignupMode = false;
        title.innerHTML = "Focus<br>Login";
        subtitle.innerText = "Log in to secure your progress and sync across devices.";
        submitBtn.innerText = "Continue";
        toggleText.innerHTML = `Don't have an account? <a href="#" onclick="auth.toggleAuthMode()">Sign Up</a>`;
        confirmInput.classList.add('hidden');
        nameFields.classList.add('hidden');
        consentContainer.classList.add('hidden');
        forgotContainer.classList.remove('hidden');
    }
}

export function showResetMode() {
    authMode = 'reset';
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const mainView = document.getElementById('auth-main-view');
    const resetView = document.getElementById('reset-password-view');
    const existsView = document.getElementById('account-exists-view');

    title.innerText = "Reset Password";
    subtitle.innerText = "Enter your email address and we'll send you a link to reset your password.";
    
    if (title) title.style.display = 'block';
    if (subtitle) subtitle.style.display = 'block';
    
    mainView.classList.add('hidden');
    resetView.classList.remove('hidden');
    if (existsView) existsView.classList.add('hidden');
}

export function showLoginMode() {
    toggleAuthMode('signup'); // This will flip it to 'login'
}

/**
 * Fear of Loss Logic
 */
export function triggerFearOfLoss() {
    const hasSeenHook = sessionStorage.getItem('hasSeenLoginHook');
    if (!hasSeenHook && !currentUser) {
        const fearPopup = document.getElementById('fear-popup');
        if (fearPopup) fearPopup.classList.remove('hidden');
    }
}

export function closeFearPopup() {
    const fearPopup = document.getElementById('fear-popup');
    if (fearPopup) fearPopup.classList.add('hidden');
    sessionStorage.setItem('hasSeenLoginHook', 'true');
}

export function getCurrentUser() {
    return currentUser;
}

// Expose to window for inline HTML handlers
window.auth = {
    openAuthModal,
    closeAuthModal,
    toggleAuthMode,
    handleAuthSubmit: async () => {
        try {
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const confirmPassword = document.getElementById('auth-confirm-password').value;
            const firstName = document.getElementById('auth-first-name').value;
            const lastName = document.getElementById('auth-last-name').value;
            const marketingConsent = document.getElementById('auth-marketing-consent').checked;
            
            if (authMode === 'login') {
                await handleLogin(email, password);
            } else if (authMode === 'signup') {
                await handleSignup(email, password, confirmPassword, firstName, lastName, marketingConsent);
            }
        } catch (error) {
            console.error("Auth Submit Error:", error);
            // Error is already handled inside handleLogin/handleSignup via showToast
        }
    },
    handlePasswordResetClick: async () => {
        if (!auth) {
            showToast("Firebase is not initialized. Please check your environment variables.");
            return;
        }
        const email = document.getElementById('reset-email').value;
        await handlePasswordReset(email);
    },
    showResetMode,
    showLoginMode,
    handleLogout,
    closeFearPopup,
    syncAuthStateUI, // Exported for the Router
    switchToLoginFromExists,
    switchToSignupFromExists
};
