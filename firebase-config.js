// PocketLedger — Firebase configuration.
//
// HOW TO CONFIGURE (free tier, no billing required):
//   1. Create a project at https://console.firebase.google.com
//   2. In the console go to AI Services > AI Logic > Get started,
//      choose the "Gemini Developer API" backend (free, no billing).
//   3. Register a Web app, copy its firebaseConfig object, and paste
//      the values below, replacing the "YOUR_..." placeholders.
//   4. Enable in the console: App Check (register the debug token the
//      browser console prints on localhost), Authentication >
//      Anonymous sign-in, Firestore Database, Remote Config.
//   5. In Remote Config, create a boolean parameter
//      "cloudReviewEnabled" (default true) and a string parameter
//      "reviewPromptVersion" (default "v1").
//
// Until real values are pasted here the app runs fully offline-first
// (localStorage ledger, dashboard, CSV export) and honestly reports
// "Firebase not configured" with all AI / sync features disabled.
// Never put a real API key in a public repo other than this web
// config object, which Firebase treats as a public client identifier.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBzrsG5swtRSYzJ0TodGcrvhoxBQ8_JOrU",
  authDomain: "pocket-ledger-38e36.firebaseapp.com",
  projectId: "pocket-ledger-38e36",
  storageBucket: "pocket-ledger-38e36.firebasestorage.app",
  messagingSenderId: "963218142390",
  appId: "1:963218142390:web:76fb0291298489ab9c6217",
};

// reCAPTCHA Enterprise site key for App Check (public key — safe to ship).
// Created 2026-11-24 for domains gom92.github.io + localhost; the web app
// is REGISTERED with it in the Firebase console as Fraud Defense
// (reCAPTCHA Enterprise) — verified "已注册" 2026-11-24. The old reCAPTCHA
// v3 key (6LcdFDAu...) is obsolete: reCAPTCHA Classic is deprecated and the
// console refuses v3 registration. Firebase AI Logic enforcement is ON for
// this project, so AI calls need the valid token this key produces. Local
// dev must serve on http://localhost (not 127.0.0.1) so the key's domain
// matches.
export const APP_CHECK_SITE_KEY = "6Ld6_S8uAAAAALdxw1hQ_O8R8hDoaX4au462qRIG";

export const FIREBASE_CONFIGURED = Object.values(FIREBASE_CONFIG).every(
  (v) => typeof v === "string" && v && !v.startsWith("YOUR_")
);
