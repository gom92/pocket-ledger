# PocketLedger — Offline-first AI expense ledger for freelancers

> Built for **Devpost #BuildHybridAI 2026** (Web/Chrome category).
> An offline-first AI expense ledger: on-device categorization keeps financial
> details private, instant and free, while the cloud turns a month of entries
> into a tax-ready summary.

## What it does

- **Add an expense** — amount, description, date. Tap **AI Classify** and
  Firebase AI Logic categorizes it with a structured JSON result:
  `{ category, deductible, note }`, using `InferenceMode.PREFER_ON_DEVICE`.
  The result badge shows the real inference source reported by the SDK —
  `ON_DEVICE` or `IN_CLOUD`. On-device inference runs first when available;
  the SDK falls back to the cloud otherwise.
- **Dashboard** — per-category totals, deductible total, monthly total,
  entry count, average, a CSS bar chart, and a recent-entries list (with delete).
- **Monthly review (cloud, opt-in only)** — off by default. When you switch it
  on, only that month's *aggregated category totals* are sent to the cloud
  model (`gemini-3.5-flash-lite`, `ONLY_IN_CLOUD`), which returns a short English
  review plus one money-saving tip. No raw expense descriptions leave the device.
- **Local-first** — entries are saved to `localStorage` first and work fully
  offline; an online/offline indicator is shown in the header.
- **Cloud sync (optional)** — anonymous sign-in backs entries up to Firestore
  (`users/{uid}/expenses`) and restores them on another device.
- **Remote Config** — `cloudReviewEnabled` (boolean) gates the monthly review
  and `reviewPromptVersion` (string) versions its prompt; live values are shown
  in the Sync section. Defaults: `true` / `"v1"`.
- **Demo data + CSV export** — one click loads 6 example expenses for the
  current month; export downloads all entries as CSV.
- **Honest no-config mode** — until a real Firebase config is added, the app
  runs fully offline and clearly says *"Firebase not configured — add your
  config to firebase-config.js"*, with AI/sync buttons disabled. It never
  fakes AI classification with keyword rules or invented on-device results.

## Run locally

No build step. Serve the folder over HTTP (ES modules + import map require it):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or deploy as-is to GitHub Pages (repo root = site root).

## Configure Firebase (free tier, no billing)

1. Create a project at https://console.firebase.google.com.
2. Go to **AI Services → AI Logic → Get started**, choose the
   **Gemini Developer API** backend (free, no billing).
3. Register a Web app and paste its config into `firebase-config.js`,
   replacing the `YOUR_FIREBASE_CONFIG_HERE` placeholders.
4. Enable in the console: **App Check** (register the debug token printed in
   the browser console on localhost), **Authentication → Anonymous**,
   **Firestore Database**, **Remote Config**.
5. In Remote Config create `cloudReviewEnabled` (boolean, default `true`)
   and `reviewPromptVersion` (string, default `v1`).
6. For production App Check, the web app must be registered in the Firebase
   console (App Check → Apps) with a reCAPTCHA Enterprise (Fraud Defense)
   site key, stored as `APP_CHECK_SITE_KEY` in `firebase-config.js`.
   (reCAPTCHA Classic / v3 is deprecated and its console input is disabled.)

## Architecture

```
index.html          UI (all English, responsive, no framework)
styles.css          Layout, dashboard chart, badges
app.js              Ledger (localStorage), dashboard, CSV, Firebase lazy-init
firebase-config.js  Placeholder config — swap in real values, nothing else changes
```

- `app.js` boots the ledger immediately; Firebase SDK modules (CDN,
  `https://www.gstatic.com/firebasejs/13.4.0/…`) are loaded with dynamic
  `import()` only when a real config exists, so a missing/offline CDN never
  breaks local use.
- AI categorization: `getAI(app, { backend: new GoogleAIBackend() })` →
  `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, … })`,
  with a JSON `responseSchema` for structured output. `initializeDeviceModel()`
  is called on the classify click (user interaction, as required) with a
  download-progress callback.
- Monthly review uses a separate cloud-only model
  (`mode: InferenceMode.ONLY_IN_CLOUD`) and sends aggregated totals only.
- Firestore rules should restrict `users/{uid}/expenses` to the matching
  anonymous UID (see `firestore.rules.example` if added during setup).

## Testing

Playwright (Chromium) tests in `tests/test.mjs` — run:

```bash
node tests/test.mjs
```

They verify: page loads with no JS errors, adding an expense updates the
dashboard totals, demo data loads, CSV export downloads, and with no Firebase
config the AI button is disabled and the honest "not configured" message is
shown. Results are recorded in `BUILD-NOTES.md`.

## License

Apache-2.0. See `LICENSE`. This app gives general bookkeeping help, not tax advice.
