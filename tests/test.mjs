// PocketLedger Playwright tests (real Chromium).
// Run: node tests/test.mjs   (from the buildhybridai-2026 directory)
// Serves the app on localhost, then checks: clean load, add-expense math,
// demo seed data, CSV export, and the honest no-config AI-disabled state.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  // Fallback for machines where only playwright-core + a cached browser exist.
  ({ chromium } = require("/tmp/pwtest/node_modules/playwright-core"));
}
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const shots = path.join(dir, "screenshots");
fs.mkdirSync(shots, { recursive: true });

const PORT = 8123;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: root });
await new Promise((r) => setTimeout(r, 1200));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

let browser;
try {
  browser = await chromium.launch({ executablePath: fs.existsSync(CHROMIUM_PATH) ? CHROMIUM_PATH : undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  check("page title", (await page.title()).includes("PocketLedger"), await page.title());
  check("no JS errors on load", errors.length === 0, errors.join(" | "));
  check("honest not-configured banner visible", await page.locator("#configBanner").isVisible());
  check("firebase status pill says not configured",
    (await page.locator("#firebaseStatus").innerText()).includes("not configured"));
  check("AI Classify button disabled without config", await page.locator("#classifyBtn").isDisabled());
  check("monthly review button disabled (opt-in off + no config)", await page.locator("#reviewBtn").isDisabled());
  check("cloud sync button disabled without config", await page.locator("#syncBtn").isDisabled());
  check("online indicator present", (await page.locator("#onlineIndicator").innerText()).length > 0);

  // Add one manual expense: $100 Travel, deductible.
  await page.fill("#amount", "100");
  await page.fill("#description", "Test taxi to client");
  await page.fill("#date", new Date().toISOString().slice(0, 10));
  await page.selectOption("#category", { label: "Travel" });
  await page.check("#deductible");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);
  check("dashboard total after 1 manual expense", (await page.locator("#totalSpent").innerText()) === "$100.00",
    await page.locator("#totalSpent").innerText());
  check("dashboard deductible after 1 manual expense", (await page.locator("#totalDeductible").innerText()) === "$100.00");
  check("dashboard entry count = 1", (await page.locator("#entryCount").innerText()) === "1");
  check("entry appears in recent list", (await page.locator("#entryList").innerText()).includes("Test taxi to client"));

  // Demo seed data: 6 entries, $921.40 total, $909.40 deductible.
  await page.click("#seedBtn");
  await page.waitForTimeout(300);
  check("dashboard total after seed (100 + 921.40)", (await page.locator("#totalSpent").innerText()) === "$1021.40",
    await page.locator("#totalSpent").innerText());
  check("dashboard deductible after seed (100 + 909.40)", (await page.locator("#totalDeductible").innerText()) === "$1009.40",
    await page.locator("#totalDeductible").innerText());
  check("dashboard entry count = 7", (await page.locator("#entryCount").innerText()) === "7");
  check("category chart has bars", (await page.locator("#categoryChart .chart-row").count()) >= 5,
    `${await page.locator("#categoryChart .chart-row").count()} rows`);

  // CSV export: real download, check contents.
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#exportBtn");
  const download = await downloadPromise;
  const csvPath = path.join(shots, "export.csv");
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  check("CSV downloads with header", csv.startsWith('"date","description","category","amount_usd"'), csv.split("\n")[0]);
  check("CSV contains manual entry", csv.includes("Test taxi to client"));
  check("CSV contains seed entry", csv.includes("Figma subscription"));
  check("CSV has 7 data rows", csv.trim().split("\n").length === 8, `${csv.trim().split("\n").length} lines`);

  // Delete one entry and confirm the total drops.
  await page.locator('#entryList li:has-text("Test taxi to client") button').click();
  await page.waitForTimeout(300);
  check("delete removes entry (total back to 921.40)", (await page.locator("#totalSpent").innerText()) === "$921.40",
    await page.locator("#totalSpent").innerText());

  await page.screenshot({ path: path.join(shots, "desktop-seeded.png"), fullPage: true });

  // Mobile viewport.
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mob.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
  await mob.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await mob.click("#seedBtn");
  await mob.waitForTimeout(300);
  check("mobile: seed loads, total $921.40", (await mob.locator("#totalSpent").innerText()) === "$921.40",
    await mob.locator("#totalSpent").innerText());
  check("mobile: no page errors", !errors.some((e) => e.startsWith("mobile")), errors.join(" | "));
  await mob.screenshot({ path: path.join(shots, "mobile-seeded.png"), fullPage: true });
} catch (err) {
  check("test run completed without harness error", false, String(err?.stack || err));
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: tests/screenshots/`);
process.exit(failed.length ? 1 : 0);
