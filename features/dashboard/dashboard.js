import { getCurrentUser, openAuthModal } from "../../core/auth.js";
import { updateDateNote } from "../../core/db.js";

export function init() {
    const addBtn = document.getElementById('dashboard-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', handleDashboardAdd);
        
        // Initial check on load
        const user = getCurrentUser();
        if (user) {
            addBtn.classList.remove('locked');
            addBtn.title = "Add daily note";
        } else {
            addBtn.classList.add('locked');
            addBtn.title = "Log in to add daily notes";
        }
    }
}

async function handleDashboardAdd() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        openAuthModal('dashboard');
        return;
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const note = prompt("Add a quick note for today:");
    
    if (note !== null) {
        try {
            await updateDateNote(currentUser.uid, todayKey, note);
            alert("Note saved successfully!");
        } catch (error) {
            alert("Failed to save note. Please try again.");
            console.error(error);
        }
    }
}
