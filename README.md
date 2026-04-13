<div align="center">
  <h1>🚀 FocusHub</h1>
  <p><strong>The Ultimate 365-Day Consistency Tracker & Student Productivity Hub.</strong></p>
  <p><em>An open-source, lightweight, and fast academic management tool helping students consolidate their 365-day tracking, syllabus management, and notes in one unified interface.</em></p>
  
  [![Version](https://img.shields.io/badge/version-v1.1.0-blue.svg)](https://github.com/3idhmind/Focus)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Vite](https://img.shields.io/badge/Vite-B73BFE?logo=vite&logoColor=white)](https://vitejs.dev/)
  [![Firebase](https://img.shields.io/badge/Powered%20by-Firebase-orange?logo=firebase)](https://firebase.google.com)
  [![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)
  
  🌐 **Live at:** [focushub.3idhmind.in](https://focushub.3idhmind.in)
</div>

---

## 📖 Introduction

**FocusHub** is a minimalist, high-performance web application designed to help individuals build unbreakable daily habits. By utilizing a pure, visual 365-day streak map, personal notebook, and advanced client-side caching, it eliminates feature bloat to trigger raw psychological accountability and long-term consistency. 

With its bespoke **State-Driven Architecture** and vanilla JavaScript foundation, FocusHub removes layers of abstraction found in modern frameworks to deliver a blazingly fast, raw, and hyper-responsive user experience.

---

## 🛠️ Tech Stack

Built from the ground up for speed, modularity, and database quota preservation:

- **Core**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Styling**: Custom CSS with an emphasis on **Glassmorphism UI** and perfectly constrained grid layouts.
- **Build Tool**: Vite (for lightning-fast HMR and optimized production bundling).
- **Database & Auth**: Firebase Engine (Firestore NoSQL, Firebase Authentication).
- **Routing**: Custom Client-side Hash Router implementing an advanced Hide-and-Show SPA paradigm.
- **Hosting**: Vercel.

---

## 🏗️ System Architecture

FocusHub operates on a deeply modular Single Page Application (SPA) framework prioritizing security, speed, and zero latency.

- **Phantom Write Protection**: Intercepts and blocks duplicate network requests to drastically cut down database quota usage.
- **Instant Reactive Navigation**: Modules don't re-render heavily; they persist and hydrate instantly in the DOM.
- **Template Injection**: The custom SPA router (`core/router.js`) dynamically injects raw HTML strings using Vite's `import.meta.glob` at runtime.

---

## 🧠 Data Flow & "The Brain" (`state.js`)

At the core of FocusHub lies **The Brain** (`core/state.js`) — a centralized, dependency-free state manager and pub/sub event bus. This guarantees that UI modules remain completely decoupled from the database and authentication layers.

### How Data Flows in FocusHub:
1. **Unidirectional Flow**: 
   `UI Module` → `dispatchAction()` → `The Brain (globalState)` → `Notify()` → `UI Re-renders` -> `Async DB Sync`
2. **Event Pub/Sub**: Modules simply subscribe to channels like `logsUpdated` or `profileUpdated`. When state changes, the Brain notifies all subscribers instantly with cloned payloads, preventing unwanted mutation.
3. **Optimistic Updates**: When a user ticks off a day, the UI updates instantly via The Brain. The database sync happens in the background. If the sync fails, The Brain automatically rolls back the snapshot and corrects the UI seamlessly.
4. **Hydration Engine**: Upon authentication, The Brain pulls raw payloads from Firebase, hydrates its in-memory graph, and issues an architecture-wide `stateReady` signal to initialize all UI modules cleanly.

---

## 📂 Folder Structure

The project strictly follows a feature-by-feature modular design. Here is the actual implementation structure:

```text
FocusHub/
├── api/                    # Vercel Serverless Functions
├── core/                   # The Architecture Foundation
│   ├── auth.js             # Custom auth logic & secure Google/Email SSO
│   ├── db.js               # Firestore CRUD wrappers & caching logic
│   ├── firebase-config.js  # Environment initialization
│   ├── router.js           # Custom SPA router handling dynamic imports
│   └── state.js            # "The Brain" - Centralized state manager
│
├── features/               # Independent Domain Modules
│   ├── 365-tracker/        # 365-day visual streak map
│   ├── dashboard/          # Hub overview
│   ├── notes/              # Integrated diary & notebook
│   ├── profile/            # User settings
│   ├── syllabus/           # Academic management features
│   └── trash/              # Secure recovery vault for soft-deletions
│
├── assets/                 # SVGs, Base CSS, Images, and Global Variables
├── app.js                  # Main entry point bridging router, auth and state
├── index.html              # Main application canvas
└── vite.config.ts          # Build tool configuration
```

---

## 💻 Local Setup & Installation

Follow these platform-specific instructions to quickly clone, install, and run FocusHub on your local machine.

### Prerequisites (All Platforms)
- [Node.js](https://nodejs.org/) (v16.0 or higher recommended)
- [Git](https://git-scm.com/)

---

### 🍎 macOS / 🐧 Linux / Ubuntu

Open your Terminal and run the following commands:

```bash
# 1. Clone the repository and enter the directory
git clone https://github.com/3idhmind/Focus.git
cd Focus

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

### 🪟 Windows (Command Prompt / PowerShell)

Open your Command Prompt or PowerShell and run the following commands:

```cmd
:: 1. Clone the repository and enter the directory
git clone https://github.com/3idhmind/Focus.git
cd Focus

:: 2. Install dependencies
npm install

:: 3. Start the development server
npm run dev
```



## 📄 License
Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

---

<div align="center">
  <strong>Built with ❤️ by <a href="https://github.com/3idhmind">3idhmind</a></strong>
</div>
