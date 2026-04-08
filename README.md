# 🚀 FocusHub

> **The Ultimate 365-Day Consistency Tracker & Student Productivity Hub.**  
> *A product by 3idhmind*  
> 🌐 **Live at:** [focushub.3idhmind.in](https://focushub.3idhmind.in)

[![Open Source Love](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)](https://github.com/3idhmind/Focus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)
[![Firebase](https://img.shields.io/badge/Powered%20by-Firebase-orange?logo=firebase)](https://firebase.google.com)

**FocusHub** is a minimalist, high-performance web application designed to help individuals build unbreakable daily habits. By utilizing a pure, visual 365-day streak map, personal notebook, and advanced client-side caching, it eliminates feature bloat to trigger raw psychological accountability and long-term consistency.

---

## ✨ Core Features

### 📅 The 365-Day Visual Tracker
A high-density, interactive horizontal map of your entire year. 
- Tick off your wins, cross out your misses, and see your consistency at a glance.
- Built with a **Hyper-Fast DOM Scheduler** that guarantees perfectly constrained CSS grid layouts regardless of when months start.
- Deeply integrated Diary system allowing you to pin contextual notes to specific dates.

### 📝 Integrated Journal & Notes
Your personal knowledge base. View all your written Daily Notes in a centralized repository, fully synchronized with the 365-Day Tracker.

### ♻️ Secure Trash & Recovery
A fully integrated soft-deletion system. Accidental deletions live in a dedicated recovery vault where they can be permanently wiped or instantly restored to your main Tracker.

### ⚡ Performance & Caching Engine (Zero Limits)
Built with an advanced **Hide-and-Show SPA Router** and a centralized `IN_MEMORY_CACHE`:
- **Phantom Write Protection**: Intercepts and blocks duplicate network requests to drastically cut down database quota usage.
- **Instant Reactive Navigation**: Modules don't re-render heavily; they persist and hydrate instantly.

### 🔐 Security & Email Automation 
- **Firebase Auth**: Industry-leading security with seamless Email/Password functionality.
- **Backend-For-Frontend (BFF) Proxy**: Sensitive API communications (like Marketing and SMTP Relays) run through isolated Vercel Serverless Functions.
- **Brevo API v3 Integration**: Automated Contact Sync triggering rich Welcome Emails upon user signup instantly!

---

## 🏗️ Architecture & Tech Stack

FocusHub operates on a modern, deeply modular Single Page Application (SPA) framework prioritizing security, speed, and Firebase quota preservation.

- **Frontend Environment**: Vite, Vanilla JavaScript (ES6+), HTML5, and pure CSS3 ("Graphite & Muted Gold" Design System).
- **Backend Routing**: Vercel Serverless Functions (Node.js) handling RESTful endpoints for third-party tools.
- **Database Layer**: Firebase Engine (Firestore NoSQL, Firebase Auth).
- **Email Infrastructure**: Brevo Dedicated SMTP Relays.

---

## 🛠️ Local Setup & Installation

Follow these steps to get FocusHub running on your local machine:

### 1. Clone the Repository
```bash
git clone https://github.com/3idhmind/Focus.git
cd Focus
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Your `.gitignore` file correctly prevents environment variables from pushing publicly. 
Create a `.env` file in the root directory and use the following template:

```env
# --- Firebase Configuration (Client-Side) ---
# Safe for Vite to bundle into public frontend strings.
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)

# --- Brevo Configuration (Server-Side Only) ---
# Specifically kept OUT of VITE_; strictly injected into Vercel SSR functions.
BREVO_API_KEY=your_brevo_api_v3_key
BREVO_LIST_ID=your_target_list_id
```

### 4. Run Development Server
**For Frontend testing only:**
```bash
npm run dev
```

**For Backend API / Sync-Contact testing:**
```bash
vercel dev
```

The app will be available at `http://localhost:3000`.

---

## 🚀 Deployment (Vercel)

FocusHub is fully optimized out-of-the-box for **Vercel** deployments.

1. **GitHub Connection**: Push to your repository and link it to your Vercel Dashboard.
2. **Inject Variables**: Pass your `.env` keys directly into your Vercel Project Settings interface. Vercel naturally passes the non-Vite keys into the Node backend.
3. **Build Command**: Vercel will automatically run `npm run build` via Vite, bundle your assets, and launch your `/api/` endpoints as serverless functions.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.

---

**Built with ❤️ by [3idhmind](https://github.com/3idhmind)**
