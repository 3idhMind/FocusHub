import { initAuth } from "./core/auth.js";
import { initRouter } from "./core/router.js";

/**
 * Focus Entry Point
 * Initializes core services and the SPA router
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log("Focus Initializing...");
    
    // 1. Initialize Authentication
    initAuth();
    
    // 2. Initialize Router
    initRouter();
});

/**
 * Global UI Helpers
 */
window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
};
