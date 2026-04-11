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
    confirmPasswordReset,
    verifyPasswordResetCode,
    updateProfile,
    setPersistence,
    browserLocalPersistence
} from "firebase/auth";

import { saveUserProfile, getUserProfile } from "./db.js";
import { subscribe, dispatchNotification, dispatchSetAuthView } from "./state.js";

// Global auth state — the single source of truth for current user
let currentUser = null;
let authMode = 'login';
let isSignupMode = false;

/**
 * getCurrentUser — safe public accessor for the confirmed auth state.
 * Use this instead of auth.currentUser to avoid race conditions.
 */
export function getCurrentUser() {
    return currentUser;
}

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
 * initAuth — The Auth-First Gatekeeper.
 * @param {Function} onAuthResolved  - One-shot callback on first auth confirmation.
 * @param {Function} [onAuthChange]  - Called on every subsequent auth state change (login/logout).
 */
export function initAuth(onAuthResolved, onAuthChange) {
    // Note: setPersistence is set once in firebase-config.js — not repeated here.
    let hasBooted = false;

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        console.log(user ? "Auth: Authenticated →" : "Auth: Guest Mode", user?.email || "");

        if (!hasBooted) {
            // === FIRST RESOLUTION: unlock the app ===
            hasBooted = true;
            if (typeof onAuthResolved === 'function') onAuthResolved(user);
        } else {
            // === SUBSEQUENT CHANGES: login/logout after boot ===
            if (typeof onAuthChange === 'function') onAuthChange(user);
        }

        // Always sync the header/banner UI
        try { syncAuthStateUI(); }
        catch (e) { console.error("UI Sync Error:", e); }

        window.dispatchEvent(new CustomEvent('authChanged', { detail: { user } }));
    });

    // Global Modal Click-Outside-to-Close
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            const modalId = e.target.id;
            if (modalId === 'auth-modal') closeAuthModal();
            else if (modalId === 'fear-popup') closeFearPopup();
            else if (modalId === 'diary-modal') {
                if (window.tracker?.closeDiary) window.tracker.closeDiary();
                else e.target.classList.add('hidden');
            } else {
                e.target.classList.add('hidden');
            }
        }

        // --- NEW: Forgot Password Link Listener (Login Page) ---
        // Uses a more robust selector to handle bubbling correctly
        const forgotLink = e.target.closest('a');
        if (forgotLink && forgotLink.parentElement?.id === 'forgot-password-container') {
            e.preventDefault(); 
            console.log("Auth: Forgot Password link clicked. Swapping view...");
            handleForgotPassword();
        }
    });

    // --- NEW: Notification Bridge ---
    // Persistent listener that survives the initState purge.
    subscribe('notification', ({ message }) => {
        showToast(message);
    }, { persistent: true });

    // --- NEW: Auth View Bridge ---
    // Persistent listener that ensures the Auth UI remains responsive across all states.
    subscribe('authViewUpdated', ({ authView: newView }) => {
        console.log("Auth UI: Syncing to view:", newView);
        _syncViewToDOM(newView);
    }, { persistent: true });

    // --- NEW: URL Interceptor (Handle Password Reset Links) ---
    checkEmailActions();
}

/**
 * _syncViewToDOM: Low-level DOM toggler for the auth modal views.
 */
function _syncViewToDOM(view) {
    const mainView = document.getElementById('auth-main-view');
    const resetView = document.getElementById('reset-password-view');
    const resetConfirmView = document.getElementById('reset-confirm-view');
    const resetSuccessView = document.getElementById('reset-success-view');
    const existsView = document.getElementById('account-exists-view');
    const updatePasswordView = document.getElementById('update-password-view');
    const resetErrorView = document.getElementById('reset-error-view');
    
    // Header elements
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    
    // Input/Populate elements
    const resetEmailInput = document.getElementById('reset-email');
    const loginEmailInput = document.getElementById('auth-email');

    // Hide all first
    const views = [mainView, resetView, resetConfirmView, resetSuccessView, existsView, updatePasswordView, resetErrorView];
    views.forEach(v => v?.classList.add('hidden'));

    if (view === 'login' || view === 'signup') {
        mainView?.classList.remove('hidden');
        if (title) {
            title.style.display = 'block';
            title.innerHTML = isSignupMode ? "Focus<br>Create Account" : "Focus<br>Login";
        }
        if (subtitle) {
            subtitle.style.display = 'block';
            subtitle.innerText = isSignupMode 
                ? "Join Focus to secure your progress and sync across devices." 
                : "Log in to secure your progress and sync across devices.";
        }
    } else if (view === 'reset') {
        resetView?.classList.remove('hidden');
        if (title) {
            title.style.display = 'block';
            title.innerText = "Reset Password";
        }
        if (subtitle) {
            subtitle.style.display = 'block';
            subtitle.innerText = "Enter your email address and we'll send you a link to reset your password.";
        }
        // Pre-fill email from login form if available
        if (resetEmailInput && loginEmailInput && loginEmailInput.value) {
            resetEmailInput.value = loginEmailInput.value;
        }
    } else if (view === 'reset-confirm') {
        resetConfirmView?.classList.remove('hidden');
        if (title) title.innerText = "Confirm Email";
        
        // Populate specific confirm text
        const email = resetEmailInput?.value || "your email";
        const confirmText = document.getElementById('reset-confirm-text');
        if (confirmText) confirmText.innerHTML = `Send password reset link to <br><strong>${email}</strong>?`;
        
    } else if (view === 'reset-success') {
        resetSuccessView?.classList.remove('hidden');
        if (title) title.style.display = 'none';
        if (subtitle) subtitle.style.display = 'none';
        
        // Populate specific success text
        const successEmail = document.getElementById('reset-success-email');
        if (successEmail) successEmail.innerText = resetEmailInput?.value || "your inbox";
        
    } else if (view === 'exists') {
        existsView?.classList.remove('hidden');
        if (title) title.style.display = 'none';
        if (subtitle) subtitle.style.display = 'none';
    } else if (view === 'update-password') {
        const updatePasswordView = document.getElementById('update-password-view');
        updatePasswordView?.classList.remove('hidden');
        if (title) title.style.display = 'none';
        if (subtitle) subtitle.style.display = 'none';
    } else if (view === 'reset-error') {
        const resetErrorView = document.getElementById('reset-error-view');
        resetErrorView?.classList.remove('hidden');
        if (title) title.style.display = 'none';
        if (subtitle) subtitle.style.display = 'none';
    }
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
        
        // Phase 4.2: Secure Contact Sync (Background — production only)
        // On localhost, /api/sync-contact is not served by Vite, so we skip it.
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            syncToBrevo(email, firstName, lastName);
        } else {
            console.log('Dev: Brevo sync skipped on localhost (runs only in production).');
        }

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

export async function handleForgotPassword(emailInput = null) {
    // SCENARIO 1: Profile Page (Email provided or logged in)
    if (currentUser || emailInput) {
        const email = emailInput || currentUser?.email;
        if (email) {
            requestProfilePasswordReset(email);
            return;
        }
    }

    // SCENARIO 2: Login Modal (Link clicked)
    // Force set the view via state.js bridge
    dispatchSetAuthView('reset');
}

/**
 * requestProfilePasswordReset — Profile-specific confirmation flow.
 */
export function requestProfilePasswordReset(email) {
    // Replace window.confirm with our premium custom modal
    openConfirmModal(
        "Reset Password",
        `Are you sure you want to send a password reset link to ${email}?`,
        () => _performPasswordReset(email)
    );
}

/**
 * _performPasswordReset — The actual Firebase call.
 */
async function _performPasswordReset(email) {
    try {
        console.log("Auth: Sending reset link to", email);
        await sendPasswordResetEmail(auth, email);
        
        // Success state depends on current context
        if (!currentUser) {
            // Guest context: Switch to success view in modal
            dispatchSetAuthView('reset-success');
        } else {
            // Auth context (Profile): Just show toast
            dispatchNotification("Reset link sent! Please check your inbox.", "success");
        }
        
    } catch (error) {
        console.error("Auth: Reset Error", error.code);
        shakeModal();
        
        let msg = error.message;
        if (error.code === 'auth/user-not-found') msg = "No account found with this email.";
        else if (error.code === 'auth/invalid-email') msg = "Please enter a valid email address.";
        else if (error.code === 'auth/too-many-requests') msg = "Too many requests. Please try later.";
        
        dispatchNotification(msg, "error");
    }
}

/**
 * checkEmailActions — Detects Firebase action URLs (e.g., password reset links).
 * Runs on page load via initAuth().
 */
export async function checkEmailActions() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    if (mode === 'resetPassword' && oobCode) {
        console.log("Auth: Detected Password Reset Link. Verifying...");
        
        try {
            // Verify if the link is still valid (not used, not expired)
            await verifyPasswordResetCode(auth, oobCode);
            
            // Link is valid, store code and open update view
            window._pendingOobCode = oobCode;
            dispatchSetAuthView('update-password');
            openAuthModal();
            
        } catch (error) {
            console.error("Auth: Password Reset Verification Failed", error.code);
            // Link is invalid or expired
            dispatchSetAuthView('reset-error');
            openAuthModal();
        }
    }
}

/**
 * handleUpdatePasswordAction — Wrapper for HTML button to trigger the update.
 */
export async function handleUpdatePasswordAction() {
    const passwordInput = document.getElementById('update-password-input');
    const confirmInput = document.getElementById('update-password-confirm');
    const newPassword = passwordInput?.value;
    const confirmPassword = confirmInput?.value;
    const oobCode = window._pendingOobCode;

    if (!newPassword || newPassword.length < 6) {
        shakeModal();
        dispatchNotification("Password must be at least 6 characters.", "error");
        return;
    }

    if (newPassword !== confirmPassword) {
        shakeModal();
        dispatchNotification("Passwords do not match. Please try again.", "error");
        if (confirmInput) {
            confirmInput.value = '';
            confirmInput.focus();
        }
        return;
    }

    if (!oobCode) {
        dispatchNotification("Invalid or expired reset link. Please request a new one.", "error");
        return;
    }

    handleUpdatePassword(newPassword, oobCode);
}

/**
 * handleUpdatePassword — The actual Firebase call to update the password.
 */
export async function handleUpdatePassword(newPassword, oobCode) {
    const saveBtn = document.getElementById('update-password-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
    }

    try {
        await confirmPasswordReset(auth, oobCode, newPassword);
        
        dispatchNotification("Password updated successfully! You can now log in.", "success");
        
        // Clean up URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Reset view and close modal (or go to login)
        dispatchSetAuthView('login');
        
        // Clear the pending code
        delete window._pendingOobCode;

    } catch (error) {
        console.error("Auth: Password Update Error", error.code);
        shakeModal();
        let msg = "Failed to update password. The link may have expired.";
        if (error.code === 'auth/weak-password') msg = "Password is too weak.";
        if (error.code === 'auth/invalid-action-code' || error.code === 'auth/expired-action-code') {
            msg = "Your reset link has expired or has already been used. Please request a new one.";
        }
        dispatchNotification(msg, "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save New Password";
        }
    }
}

/**
 * Handle Password Reset (UI helper for explicit Send button in Reset View)
 */
export async function handlePasswordReset(email) {
    if (!email) {
        dispatchNotification("Please enter your email.");
        return;
    }
    await _performPasswordReset(email);
}

/**
 * Background sync to Brevo via BFF Proxy
 */
async function syncToBrevo(email, firstName, lastName) {
    try {
        if (!auth || !auth.currentUser) {
            console.warn("Brevo Sync Warning: No authenticated user to authorize sync.");
            return;
        }
        
        // Retrieve valid Firebase ID token to authorize serverless function
        const idToken = await auth.currentUser.getIdToken(true);

        // Silent background fetch to our Vercel Serverless Function
        const response = await fetch('/api/sync-contact', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ email, firstName, lastName })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.warn("Brevo Sync Warning: Failed to sync contact.", errorData);
        } else {
            console.log("Brevo Sync Success: User added to mailing list.");
        }
    } catch (err) {
        console.error("Brevo Sync Error (Network or Token):", err);
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
    dispatchSetAuthView('login');
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
    dispatchSetAuthView('reset');
}

export function showLoginMode() {
    dispatchSetAuthView('login');
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

/**
 * handlePasswordResetNext — Transition from email input to confirmation.
 */
export function handlePasswordResetNext() {
    const email = document.getElementById('reset-email').value;
    if (!email || !email.includes('@')) {
        shakeModal();
        dispatchNotification("Please enter a valid email address.", "error");
        return;
    }
    dispatchSetAuthView('reset-confirm');
}

/**
 * Confirm Modal Helpers
 */
export function openConfirmModal(title, text, onConfirm) {
    const modal = document.getElementById('general-confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const textEl = document.getElementById('confirm-modal-text');
    const yesBtn = document.getElementById('confirm-modal-yes');

    if (titleEl) titleEl.innerText = title;
    if (textEl) textEl.innerText = text;

    // Set up confirmation action
    yesBtn.onclick = () => {
        onConfirm();
        closeConfirmModal();
    };

    modal.classList.remove('hidden');
}

export function closeConfirmModal() {
    document.getElementById('general-confirm-modal').classList.add('hidden');
}

// Expose to window for inline HTML handlers
window.auth = {
    openAuthModal,
    closeAuthModal,
    toggleAuthMode,
    handleForgotPassword,
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
        }
    },
    handlePasswordResetClick: async () => {
        const email = document.getElementById('reset-email').value;
        await _performPasswordReset(email);
    },
    handlePasswordResetNext,
    showResetMode,
    showLoginMode,
    handleLogout,
    closeConfirmModal,
    closeFearPopup,
    syncAuthStateUI,
    switchToLoginFromExists,
    switchToSignupFromExists,
    handleUpdatePasswordAction: () => handleUpdatePasswordAction()
};
