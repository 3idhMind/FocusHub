/**
 * SPA Router for Focus
 * Loads feature modules into the main canvas
 */

const appCanvas = document.getElementById('app-canvas');
const navItems = document.querySelectorAll('.nav-item');

// Vite Dynamic Import Maps for Production Statically Analyzable Bundling
const htmlModules = import.meta.glob('../features/**/*.html', { query: '?raw', import: 'default' });
const jsModules = import.meta.glob('../features/**/*.js');
const cssModules = import.meta.glob('../features/**/*.css');

const routes = {
    'tool-dashboard': {
        html: '../features/dashboard/dashboard.html',
        js: '../features/dashboard/dashboard.js'
    },
    'tool-365': {
        html: '../features/365-tracker/tracker.html',
        js: '../features/365-tracker/tracker.js',
        css: '../features/365-tracker/tracker.css'
    },
    'tool-syllabus': {
        html: '../features/syllabus/syllabus.html',
        js: '../features/syllabus/syllabus.js',
        css: '../features/syllabus/syllabus.css'
    },
    'tool-notes': {
        html: '../features/notes/notes.html',
        js: '../features/notes/notes.js',
        css: '../features/notes/notes.css'
    },
    'tool-trash': {
        html: '../features/trash/trash.html',
        js: '../features/trash/trash.js',
        css: '../features/trash/trash.css'
    },
    'tool-profile': {
        html: '../features/profile/profile.html',
        js: '../features/profile/profile.js',
        css: '../features/profile/profile.css'
    }
};

export async function navigate(targetId) {
    const route = routes[targetId];
    if (!route) return;

    // 1. Update active state on navigation items
    navItems.forEach(nav => nav.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // 2. Check if wrapper for this route already exists
    let newWrapper = document.getElementById(`wrapper-${targetId}`);
    
    // Create new wrapper if needed, but KEEP old wrappers visible for now (Zero CLS)
    if (!newWrapper) {
        newWrapper = document.createElement('div');
        newWrapper.id = `wrapper-${targetId}`;
        newWrapper.className = 'module-wrapper tool-view active'; // Add classes for animation
        newWrapper.style.minHeight = '100%';
        newWrapper.style.width = '100%';
        
        // Hide initially while loading to prevent flashes of unstyled content
        newWrapper.style.display = 'none';
        appCanvas.appendChild(newWrapper);

        // Load HTML Content
        if (route.html) {
            try {
                if (htmlModules[route.html]) {
                    const html = await htmlModules[route.html]();
                    newWrapper.innerHTML = html;
                } else {
                    throw new Error(`Glob import not found for HTML: ${route.html}`);
                }
            } catch (error) {
                console.error(`Failed to load HTML for ${targetId}:`, error);
                newWrapper.innerHTML = `<div class="placeholder-content"><h2>Error</h2><p>Failed to load feature.</p></div>`;
            }
        } else if (route.content) {
            newWrapper.innerHTML = route.content;
        }

        // Load CSS Content via Vite chunk importer
        if (route.css) {
            try {
                if (cssModules[route.css]) {
                    await cssModules[route.css]();
                } else {
                    console.warn(`Glob import not found for CSS: ${route.css}`);
                }
            } catch (error) {
                console.error(`Failed to load CSS for ${targetId}:`, error);
            }
        }

        // Load JS Content via Vite dynamic import map
        if (route.js) {
            try {
                if (jsModules[route.js]) {
                    const module = await jsModules[route.js]();
                    // Store module reference on the DOM node for onShow() calls later
                    newWrapper._module = module;
                    if (module.init) {
                        module.init();
                    }
                } else {
                    console.warn(`Glob import not found for JS: ${route.js}`);
                }
            } catch (error) {
                console.error(`Failed to load JS for ${targetId}:`, error);
            }
        }
    } else {
        // Wrapper already exists — module was previously initialized.
        // Call onShow() to re-render from current in-memory state (zero network).
        if (newWrapper._module && typeof newWrapper._module.onShow === 'function') {
            newWrapper._module.onShow();
        }
    }

    // 3. Now that the new content is completely ready, hide ALL other wrappers
    const wrappers = appCanvas.querySelectorAll('.module-wrapper');
    wrappers.forEach(w => {
        if (w.id !== `wrapper-${targetId}`) {
            w.style.display = 'none';
            w.classList.remove('active');
        }
    });

    // Show the newly prepared wrapper
    newWrapper.style.display = '';
    newWrapper.classList.add('active');

    // 4. Hide popup if it's open (global popup logic specific to Tracker)
    const popup = document.getElementById('action-popup');
    if (popup) popup.style.display = 'none';

    // 5. Sync Auth UI (Banner, Locked buttons, etc.)
    if (window.auth && window.auth.syncAuthStateUI) {
        window.auth.syncAuthStateUI();
    }
}

export function initRouter() {
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('data-target');
            navigate(targetId);
        });
    });

    // Load default route (365 Tracker as per current active state)
    const defaultTarget = document.querySelector('.nav-item.active')?.getAttribute('data-target') || 'tool-365';
    navigate(defaultTarget);
}
