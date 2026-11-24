// PocketLedger — offline-first AI expense ledger for freelancers.
// Architecture: the ledger itself is 100% local (localStorage) and works
// with no network and no Firebase config. Firebase (AI Logic hybrid
// inference, App Check, Firestore sync, Remote Config) is loaded lazily
// via dynamic import and only initialized when a real config is present
// in firebase-config.js. AI results are NEVER faked: categorization comes
// only from a real model call, and the UI badge shows the inference
// source exactly as the SDK reports it (response.inferenceSource).

import { FIREBASE_CONFIG, APP_CHECK_SITE_KEY, FIREBASE_CONFIGURED } from "./firebase-config.js";

export const SDK_VERSION = "13.4.0"; // Firebase JS SDK, verified on gstatic (v12.5.0+ required for on-device inference)
const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

export const CATEGORIES = ["Travel", "Meals", "Supplies", "Software", "Rent & Utilities", "Marketing", "Other"];
const STORAGE_KEY = "pocketledger.entries.v1";
const CONSENT_KEY = "pocketledger.cloudReviewConsent.v1";
const CLOUD_MODEL = "gemini-2.5-flash"; // cloud fallback / monthly-review model

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n || 0).toFixed(2);

// ---------------------------------------------------------------- ledger
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveEntries(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function uid() {
  return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function seedEntries() {
  const now = new Date();
  const day = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  return [
    { id: uid(), amount: 486.00, description: "Flight to client site — Chicago", date: day(2), category: "Travel", deductible: true, note: "Business travel to a client site is generally deductible.", inferenceSource: "SEED" },
    { id: uid(), amount: 68.40, description: "Team lunch with client", date: day(3), category: "Meals", deductible: true, note: "Business meals with a client are generally partially deductible.", inferenceSource: "SEED" },
    { id: uid(), amount: 220.00, description: "Coworking space — monthly desk", date: day(5), category: "Rent & Utilities", deductible: true, note: "Workspace rent used for freelance work is generally deductible.", inferenceSource: "SEED" },
    { id: uid(), amount: 120.00, description: "Facebook ads for portfolio", date: day(7), category: "Marketing", deductible: true, note: "Advertising for your freelance business is generally deductible.", inferenceSource: "SEED" },
    { id: uid(), amount: 15.00, description: "Figma subscription", date: day(11), category: "Software", deductible: true, note: "Software subscriptions used for freelance work are generally deductible.", inferenceSource: "SEED" },
    { id: uid(), amount: 12.00, description: "Coffee on the way home (personal)", date: day(12), category: "Meals", deductible: false, note: "Personal meals are not deductible.", inferenceSource: "SEED" },
  ];
}

// ---------------------------------------------------------------- dashboard
let entries = loadEntries();
let selectedMonth = currentMonth();

function monthEntries() {
  return entries.filter((e) => (e.date || "").startsWith(selectedMonth));
}
function render() {
  const list = monthEntries();
  const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
  const deductible = list.filter((e) => e.deductible).reduce((s, e) => s + Number(e.amount || 0), 0);
  $("totalSpent").textContent = money(total);
  $("totalDeductible").textContent = money(deductible);
  $("entryCount").textContent = String(list.length);
  $("avgEntry").textContent = money(list.length ? total / list.length : 0);

  // Category chart (pure CSS bars).
  const byCat = new Map(CATEGORIES.map((c) => [c, 0]));
  for (const e of list) byCat.set(e.category, (byCat.get(e.category) || 0) + Number(e.amount || 0));
  const max = Math.max(0, ...byCat.values());
  const chart = $("categoryChart");
  chart.innerHTML = "";
  for (const [cat, sum] of byCat) {
    if (sum <= 0) continue;
    const row = document.createElement("div");
    row.className = "chart-row";
    const pct = max ? (sum / max) * 100 : 0;
    row.innerHTML = `<span>${cat}</span><div class="chart-bar" style="width:${pct.toFixed(1)}%"></div><span class="amount">${money(sum)}</span>`;
    chart.appendChild(row);
  }
  if (!chart.children.length) chart.innerHTML = '<p class="muted small">No spending in this month yet.</p>';

  // Recent entries, newest first.
  const ul = $("entryList");
  ul.innerHTML = "";
  const sorted = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const e of sorted) {
    const li = document.createElement("li");
    const badge = e.inferenceSource && e.inferenceSource !== "SEED"
      ? ` <span class="pill ${e.inferenceSource === "ON_DEVICE" ? "pill-device" : "pill-cloud"}">${e.inferenceSource}</span>` : "";
    li.innerHTML = `<span><span class="desc"></span> <span class="cat"></span>${badge}</span><span class="amt">${money(e.amount)}</span>`;
    li.querySelector(".desc").textContent = e.description;
    li.querySelector(".cat").textContent = `· ${e.date} · ${e.category}`;
    if (e.deductible) {
      const d = document.createElement("span");
      d.className = "deduct";
      d.textContent = " ✓ deductible";
      li.querySelector(".amt").after(d);
    }
    if (e.note) {
      const n = document.createElement("span");
      n.className = "note";
      n.textContent = e.note;
      li.appendChild(n);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete ${e.description}`);
    del.addEventListener("click", () => {
      entries = entries.filter((x) => x.id !== e.id);
      saveEntries(entries);
      render();
      void syncToFirestore();
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
  $("emptyState").hidden = list.length > 0;
}

// ---------------------------------------------------------------- CSV
function toCSV(list) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["date", "description", "category", "amount_usd", "deductible", "ai_note", "inference_source"]];
  for (const e of [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    rows.push([e.date, e.description, e.category, Number(e.amount).toFixed(2), e.deductible ? "yes" : "no", e.note || "", e.inferenceSource || ""]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
function exportCSV() {
  const csv = toCSV(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pocketledger-${selectedMonth}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- Firebase (lazy, config-gated)
let fb = null; // { app, ai, auth, db, rc, cloudReviewEnabled, reviewPromptVersion }
let fbInitPromise = null;

async function initFirebase() {
  if (fbInitPromise) return fbInitPromise;
  fbInitPromise = (async () => {
    if (!FIREBASE_CONFIGURED) return null;
    const [
      { initializeApp },
      { initializeAppCheck, ReCaptchaV3Provider },
      { getAI, GoogleAIBackend },
      { getAuth },
      { getFirestore },
      { getRemoteConfig, fetchAndActivate, getValue },
    ] = await Promise.all([
      import(`${SDK_BASE}/firebase-app.js`),
      import(`${SDK_BASE}/firebase-app-check.js`),
      import(`${SDK_BASE}/firebase-ai.js`),
      import(`${SDK_BASE}/firebase-auth.js`),
      import(`${SDK_BASE}/firebase-firestore.js`),
      import(`${SDK_BASE}/firebase-remote-config.js`),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    // App Check debug provider for local development / GitHub Pages preview:
    // must be set BEFORE initializeAppCheck; the console prints a debug
    // token to register in the Firebase console (App Check > Manage debug tokens).
    try {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn("App Check init failed (AI calls may be rejected):", err);
    }
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const rc = getRemoteConfig(app);
    rc.settings = { minimumFetchIntervalMillis: 3600000 };
    rc.defaultConfig = { cloudReviewEnabled: true, reviewPromptVersion: "v1" };
    let cloudReviewEnabled = true;
    let reviewPromptVersion = "v1";
    try {
      // A hung Remote Config fetch must never block AI/sync init forever
      // (seen on slow networks: the fetch can stall with no error). Fall
      // back to the documented defaults after 15s and keep going.
      await Promise.race([
        fetchAndActivate(rc),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Remote Config fetch timed out after 15s")), 15000)),
      ]);
      cloudReviewEnabled = getValue(rc, "cloudReviewEnabled").asBoolean();
      reviewPromptVersion = getValue(rc, "reviewPromptVersion").asString() || "v1";
    } catch (err) {
      console.warn("Remote Config fetch failed, using defaults:", err);
    }
    fb = { app, ai, auth: getAuth(app), db: getFirestore(app), rc, cloudReviewEnabled, reviewPromptVersion };
    return fb;
  })().catch((err) => {
    console.error("Firebase init failed:", err);
    fbInitPromise = null;
    return null;
  });
  return fbInitPromise;
}

function aiSchema(Schema) {
  return Schema.object({
    properties: {
      category: Schema.enumString(CATEGORIES, { description: "One of the fixed expense categories." }),
      deductible: Schema.boolean({ description: "Whether this expense is generally tax-deductible for a freelancer." }),
      note: Schema.string({ description: "One short English sentence explaining the category and deductibility." }),
    },
    required: ["category", "deductible", "note"],
  });
}

function classifyPrompt(amount, description, date) {
  return `You are a bookkeeping assistant for a freelancer. Classify this expense and reply with JSON only.\n` +
    `Expense: $${Number(amount).toFixed(2)} on ${date} — "${description}".\n` +
    `Categories (pick exactly one): ${CATEGORIES.join(", ")}.\n` +
    `Decide whether the expense is generally tax-deductible for a freelancer in the US.`;
}

// Called from a user click, as the docs require for on-device models.
async function classifyExpense() {
  const status = $("aiStatus");
  const amount = parseFloat($("amount").value);
  const description = $("description").value.trim();
  const date = $("date").value;
  if (!amount || amount <= 0 || !description || !date) {
    status.textContent = "Enter an amount, description and date first, then tap AI Classify.";
    return;
  }
  const btn = $("classifyBtn");
  btn.disabled = true;
  status.textContent = "Preparing on-device model… (first run may download the model)";
  try {
    const f = await initFirebase();
    if (!f) throw new Error("Firebase is not configured.");
    const { getGenerativeModel, InferenceMode, Schema } = await import(`${SDK_BASE}/firebase-ai.js`);
    const schema = aiSchema(Schema);
    // getGenerativeModel must be called on/after a user interaction.
    const model = getGenerativeModel(f.ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
      },
      onDeviceParams: { promptOptions: { responseConstraint: schema } },
    });
    // Required before the first prompt: starts (or resumes) the on-device
    // model download, with progress reported to the callback.
    if (typeof model.initializeDeviceModel === "function") {
      try {
        await Promise.race([
          model.initializeDeviceModel((p) => {
            status.textContent = `Downloading on-device model… ${Math.round(p * 10000) / 100}%`;
          }),
          new Promise((resolve) => setTimeout(resolve, 30000)),
        ]);
      } catch (err) {
        console.warn("initializeDeviceModel did not complete; continuing — the SDK falls back to cloud:", err);
      }
    }
    status.textContent = "Classifying…";
    const result = await model.generateContent(classifyPrompt(amount, description, date));
    const response = result.response;
    const source = response.inferenceSource || "unknown"; // ON_DEVICE | IN_CLOUD, as reported by the SDK
    const parsed = JSON.parse(response.text());
    if (!CATEGORIES.includes(parsed.category) || typeof parsed.deductible !== "boolean" || typeof parsed.note !== "string") {
      throw new Error("Model returned an unexpected result shape.");
    }
    $("category").value = parsed.category;
    $("deductible").checked = parsed.deductible;
    const out = $("aiResult");
    out.hidden = false;
    out.innerHTML = "";
    const badge = document.createElement("span");
    badge.className = `pill ${source === "ON_DEVICE" ? "pill-device" : "pill-cloud"}`;
    badge.textContent = source;
    out.append("AI result: ", badge, document.createTextNode(` ${parsed.category} · ${parsed.deductible ? "deductible" : "not deductible"} — ${parsed.note}`));
    status.textContent = source === "ON_DEVICE"
      ? "Classified on-device — your expense details never left this device."
      : "On-device model unavailable here, so this was classified in the cloud (fallback).";
  } catch (err) {
    console.error("AI classification failed:", err);
    status.textContent = "AI classification failed: " + (err?.message || err) + " Nothing was filled in — pick a category manually.";
  } finally {
    btn.disabled = !FIREBASE_CONFIGURED;
  }
}

async function generateMonthlyReview() {
  const out = $("reviewOutput");
  const gate = $("reviewGate");
  const list = monthEntries();
  if (!list.length) {
    gate.textContent = "No entries this month yet — add some expenses first.";
    return;
  }
  const btn = $("reviewBtn");
  btn.disabled = true;
  gate.textContent = "Sending this month's summary to the cloud…";
  try {
    const f = await initFirebase();
    if (!f) throw new Error("Firebase is not configured.");
    const { getGenerativeModel, InferenceMode } = await import(`${SDK_BASE}/firebase-ai.js`);
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCat = {};
    for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
    const summary = Object.entries(byCat).map(([c, s]) => `${c}: $${s.toFixed(2)}`).join("; ");
    // Only aggregated totals leave the device — no raw descriptions.
    const prompt = `You are a friendly finance coach for a freelancer. Here is their ${selectedMonth} expense summary ` +
      `(prompt version ${f.reviewPromptVersion}): ${list.length} entries, total $${total.toFixed(2)}. By category — ${summary}. ` +
      `Write a short monthly review in English (max 120 words) plus exactly ONE concrete money-saving tip for next month. ` +
      `Do not give tax advice; suggest consulting a tax professional for deductible items.`;
    const model = getGenerativeModel(f.ai, { model: CLOUD_MODEL, mode: InferenceMode.ONLY_IN_CLOUD });
    const result = await model.generateContent(prompt);
    out.hidden = false;
    out.textContent = result.response.text();
    gate.textContent = `Review generated in the cloud (Remote Config prompt ${f.reviewPromptVersion}). Only category totals were sent — no expense descriptions.`;
  } catch (err) {
    console.error("Monthly review failed:", err);
    gate.textContent = "Monthly review failed: " + (err?.message || err);
  } finally {
    updateReviewGate();
  }
}

// ---------------------------------------------------------------- Firestore sync (opt-in, anonymous)
let syncUid = null;
async function enableSync() {
  const s = $("syncStatus");
  try {
    const f = await initFirebase();
    if (!f) throw new Error("Firebase is not configured.");
    const { signInAnonymously } = await import(`${SDK_BASE}/firebase-auth.js`);
    const cred = await signInAnonymously(f.auth);
    syncUid = cred.user.uid;
    s.textContent = `Signed in anonymously. Syncing ${entries.length} local entries to Firestore…`;
    await syncToFirestore();
    await pullFromFirestore();
    s.textContent = `Cloud sync on (anonymous). ${entries.length} entries backed up to Firestore.`;
  } catch (err) {
    console.error("Sync failed:", err);
    s.textContent = "Cloud sync failed: " + (err?.message || err);
  }
}
async function syncToFirestore() {
  if (!fb || !syncUid) return;
  try {
    const { collection, doc, setDoc } = await import(`${SDK_BASE}/firebase-firestore.js`);
    const col = collection(fb.db, "users", syncUid, "expenses");
    for (const e of entries) await setDoc(doc(col, e.id), { ...e, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn("Firestore push failed:", err);
  }
}
async function pullFromFirestore() {
  if (!fb || !syncUid) return;
  try {
    const { collection, getDocs } = await import(`${SDK_BASE}/firebase-firestore.js`);
    const snap = await getDocs(collection(fb.db, "users", syncUid, "expenses"));
    const remote = [];
    snap.forEach((d) => { const v = d.data(); if (v && typeof v.amount === "number") remote.push(v); });
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const r of remote) if (!byId.has(r.id)) byId.set(r.id, r);
    entries = [...byId.values()];
    saveEntries(entries);
    render();
  } catch (err) {
    console.warn("Firestore pull failed:", err);
  }
}

// ---------------------------------------------------------------- online / review gate
function updateOnline() {
  const el = $("onlineIndicator");
  const online = navigator.onLine;
  el.textContent = online ? "● Online" : "● Offline — local mode";
  el.className = "pill " + (online ? "pill-online" : "pill-offline");
}
function updateReviewGate() {
  const toggle = $("cloudReviewToggle");
  const btn = $("reviewBtn");
  const gate = $("reviewGate");
  const consent = toggle.checked;
  if (!FIREBASE_CONFIGURED) {
    btn.disabled = true;
    gate.textContent = "Unavailable — Firebase is not configured yet.";
  } else if (!consent) {
    btn.disabled = true;
    gate.textContent = "Turn the switch on to allow this month's summary to be sent to the cloud.";
  } else if (fb && fb.cloudReviewEnabled === false) {
    btn.disabled = true;
    gate.textContent = "Cloud review is currently disabled by Remote Config (cloudReviewEnabled = false).";
  } else {
    btn.disabled = false;
    gate.textContent = "Ready. Only this month's category totals will be sent — no raw descriptions.";
  }
}

// ---------------------------------------------------------------- boot
function boot() {
  window.__pocketLedgerBooted = true;
  $("sdkVersion").textContent = "v" + SDK_VERSION;
  $("date").value = new Date().toISOString().slice(0, 10);
  $("monthPicker").value = selectedMonth;
  $("cloudReviewToggle").checked = localStorage.getItem(CONSENT_KEY) === "1";

  // Firebase status + AI availability (honest when unconfigured).
  if (FIREBASE_CONFIGURED) {
    $("firebaseStatus").textContent = "Firebase: configured";
    $("firebaseStatus").className = "pill pill-ok";
    $("configBanner").hidden = true;
    $("classifyBtn").disabled = false;
    $("syncBtn").disabled = false;
    $("syncStatus").textContent = "Sync is off. Tap “Enable anonymous cloud sync” to back up to Firestore.";
    initFirebase().then((f) => {
      if (!f) return;
      $("rcReview").textContent = String(f.cloudReviewEnabled);
      $("rcPrompt").textContent = f.reviewPromptVersion;
      updateReviewGate();
    });
  } else {
    $("firebaseStatus").textContent = "Firebase: not configured";
    $("firebaseStatus").className = "pill pill-warn";
    $("configBanner").hidden = false;
    $("classifyBtn").disabled = true;
    $("syncBtn").disabled = true;
    $("aiStatus").textContent = "AI Classify is disabled: Firebase not configured — add your config to firebase-config.js.";
  }

  updateOnline();
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateReviewGate();

  $("monthPicker").addEventListener("change", (e) => {
    selectedMonth = e.target.value || currentMonth();
    render();
  });
  $("cloudReviewToggle").addEventListener("change", (e) => {
    localStorage.setItem(CONSENT_KEY, e.target.checked ? "1" : "0");
    updateReviewGate();
  });
  $("classifyBtn").addEventListener("click", classifyExpense);
  $("reviewBtn").addEventListener("click", generateMonthlyReview);
  $("syncBtn").addEventListener("click", enableSync);
  $("exportBtn").addEventListener("click", exportCSV);
  $("seedBtn").addEventListener("click", () => {
    const seeds = seedEntries();
    const ids = new Set(entries.map((e) => e.id));
    for (const s of seeds) if (!ids.has(s.id)) entries.push(s);
    saveEntries(entries);
    render();
    void syncToFirestore();
  });
  $("expenseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseFloat($("amount").value);
    const description = $("description").value.trim();
    const date = $("date").value;
    const category = $("category").value;
    if (!amount || amount <= 0 || !description || !date) return;
    if (!category) {
      $("aiStatus").textContent = "Pick a category, or tap AI Classify to have the model pick one.";
      $("category").focus();
      return;
    }
    entries.push({
      id: uid(), amount, description, date, category,
      deductible: $("deductible").checked,
      note: $("aiResult").hidden ? "" : $("aiResult").textContent.replace(/^AI result:\s*/, ""),
      inferenceSource: $("aiResult").hidden ? "MANUAL" : ($("aiResult").querySelector(".pill")?.textContent || "MANUAL"),
      createdAt: new Date().toISOString(),
    });
    saveEntries(entries);
    e.target.reset();
    $("date").value = new Date().toISOString().slice(0, 10);
    $("aiResult").hidden = true;
    $("aiResult").textContent = "";
    $("aiStatus").textContent = "";
    render();
    void syncToFirestore();
  });

  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
