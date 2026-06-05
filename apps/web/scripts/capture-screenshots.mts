/**
 * capture-screenshots.mts
 *
 * Capture the 12 hero views of Orchester for the marketing landing.
 *
 * Usage:
 *   pnpm tsx scripts/capture-screenshots.mts             # use cached session
 *   pnpm tsx scripts/capture-screenshots.mts --login     # force interactive re-login
 *
 * Flow:
 *   1. Look for cached storage state at .cache/screenshots-session.json
 *      (gitignored — your session never leaves your machine).
 *   2. If missing OR --login was passed: open a headed browser at /en/login,
 *      wait for you to sign in, then persist storage state when the URL
 *      lands on /workspaces (or any non-login route inside the workspace).
 *   3. Headless: iterate over SHOTS, navigate, wait for a sentinel selector,
 *      screenshot to apps/web/public/screenshots/<slug>.png.
 *
 * Each shot is taken at 1440×900 (matches marketing layout 1.6x aspect)
 * with prefers-color-scheme: dark + the in-app theme preference forced to
 * dark via localStorage. The app's HeroUI surfaces respond to both.
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_ROOT = resolve(__dirname, "..");

const BASE_URL = process.env["ORCHESTER_BASE_URL"] ?? "http://localhost:3333";
const LOCALE = process.env["ORCHESTER_LOCALE"] ?? "en";
const WORKSPACE = process.env["ORCHESTER_WORKSPACE_SLUG"] ?? "acme-inc";

const STATE_PATH = resolve(WEB_ROOT, ".cache/screenshots-session.json");
const OUT_DIR = resolve(WEB_ROOT, "public/screenshots");

const VIEWPORT = { width: 1440, height: 900 };

interface Shot {
  /** kebab-case file name (no extension) */
  slug: string;
  /** path appended to /:locale/:workspaceSlug */
  path: string;
  /** human description shown in console */
  label: string;
  /**
   * Optional sentinel text; we wait for it to be visible before shooting.
   * Falls back to a 1500ms idle if omitted.
   */
  waitFor?: string;
  /** Extra ms to wait after navigation idles (let charts/canvas paint). */
  settleMs?: number;
}

// Slug + path map. Detail IDs are seed-stable — see packages/db/src/seed-demo.ts.
const SHOTS: Shot[] = [
  { slug: "01-dashboard", path: "", label: "Command Center / dashboard", waitFor: "Command Center" },
  { slug: "02-flows-list", path: "/flows", label: "Flows list", waitFor: "Lead qualification" },
  {
    slug: "03-flow-editor",
    path: "/flows/lmcqjhloxqzqektov7sjqp15",
    label: "Flow editor canvas (Support triage)",
    settleMs: 2500,
  },
  { slug: "04-agents", path: "/agents", label: "Agents catalog", waitFor: "Social Scheduler" },
  {
    slug: "05-agent-detail",
    path: "/agents/pcha7x7m6xrqezk34b5l42k7",
    label: "Agent detail (SEO Optimizer)",
    settleMs: 1500,
  },
  { slug: "06-conversations", path: "/conversations", label: "Conversations list" },
  { slug: "07-knowledge", path: "/knowledge", label: "Knowledge bases" },
  { slug: "08-brain", path: "/brain", label: "Memory / Brain" },
  { slug: "09-org", path: "/org", label: "Org chart", settleMs: 1500 },
  { slug: "10-usage", path: "/usage", label: "Cost & usage" },
  { slug: "11-integrations", path: "/integrations", label: "Integrations catalog" },
  { slug: "12-settings", path: "/settings", label: "Settings · providers" },
];

function buildUrl(shot: Shot): string {
  return `${BASE_URL}/${LOCALE}/${WORKSPACE}${shot.path}`;
}

/** Force dark theme so screenshots look good on the dark marketing landing. */
async function forceDarkMode(context: BrowserContext): Promise<void> {
  // Pre-set localStorage on the origin so the app boots in dark.
  await context.addInitScript(() => {
    try {
      // next-themes default key. Harmless if the app uses something else.
      window.localStorage.setItem("theme", "dark");
      window.localStorage.setItem("orchester:theme", "dark");
      document.documentElement.classList.add("dark");
    } catch {
      // localStorage may be unavailable in some isolation modes — non-fatal.
    }
  });
}

/** Headed login flow — pauses until a real session cookie is present. */
async function interactiveLogin(): Promise<void> {
  console.log("\n▸ Cached session not found (or --login passed).");
  console.log("  Opening a headed browser. Sign in once, then this script");
  console.log("  will capture the session automatically and continue.\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: VIEWPORT });
  await forceDarkMode(context);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/${LOCALE}/login`, { waitUntil: "domcontentloaded" });

  console.log("  Waiting for sign-in to complete…");
  // 1. Wait for the URL to leave /login.
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 5 * 60_000 });
  // 2. Then wait for better-auth's session cookie to materialize. Without
  //    this we used to save state with only NEXT_LOCALE in it — useless for
  //    headless captures, which then silently shot the login page.
  const isAuthCookie = (name: string): boolean =>
    name.includes("better-auth") || name.startsWith("__Secure-better-auth") || name === "session";
  await page
    .waitForFunction(
      () =>
        document.cookie.split("; ").some((c) => {
          const k = c.split("=")[0] ?? "";
          return k.includes("better-auth") || k.startsWith("__Secure-better-auth") || k === "session";
        }),
      { timeout: 60_000 }
    )
    .catch(() => undefined);
  // Belt-and-suspenders: small idle so any post-login redirect settles.
  await page.waitForTimeout(1500);

  const cookies = await context.cookies();
  const authCookies = cookies.filter((c) => isAuthCookie(c.name));
  if (authCookies.length === 0) {
    console.error("\n✗ No auth cookie found after sign-in.");
    console.error("  Cookies present:", cookies.map((c) => c.name).join(", ") || "(none)");
    console.error("  Are you sure you finished the login flow? Try again with --login.");
    await browser.close();
    process.exit(1);
  }

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
  console.log(`✓ Session saved (${cookies.length} cookies, ${authCookies.length} auth) to ${STATE_PATH}`);
  await browser.close();
}

async function captureOne(page: Page, shot: Shot, index: number, total: number): Promise<void> {
  const url = buildUrl(shot);
  const file = resolve(OUT_DIR, `${shot.slug}.png`);
  const tag = `[${String(index + 1).padStart(2, "0")}/${total}]`;
  process.stdout.write(`${tag} ${shot.label.padEnd(38)} → ${shot.slug}.png … `);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // `waitFor` is a hint, not a hard gate — if the sentinel never shows up
    // we still want a screenshot (the page may have rendered fine but the
    // text was different). Swallow timeout, fall through to settle.
    if (shot.waitFor) {
      await page
        .getByText(shot.waitFor)
        .first()
        .waitFor({ state: "visible", timeout: 12_000 })
        .catch(() => {
          /* keep going — better to capture an imperfect frame than nothing */
        });
    }
    await page.waitForTimeout(shot.settleMs ?? 1500);
    // Belt-and-suspenders: nudge any deferred frame paint.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: file, type: "png", fullPage: false });
    console.log("OK");
  } catch (err) {
    console.log(`FAIL (${(err as Error).message.split("\n")[0]})`);
  }
}

/**
 * Resolve the actual list of shots to capture based on CLI flags:
 *   --only=01,04,07   → just those slugs (matched by leading digits)
 *   --missing         → skip slugs whose PNG already exists on disk
 * Default: all shots.
 */
function resolveShots(): Shot[] {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  if (onlyArg) {
    const ids = onlyArg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return SHOTS.filter((s) => ids.some((id) => s.slug.startsWith(id)));
  }
  if (process.argv.includes("--missing")) {
    return SHOTS.filter((s) => !existsSync(resolve(OUT_DIR, `${s.slug}.png`)));
  }
  return SHOTS;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--login");
  if (force && existsSync(STATE_PATH)) rmSync(STATE_PATH);
  if (!existsSync(STATE_PATH)) await interactiveLogin();

  mkdirSync(OUT_DIR, { recursive: true });

  const shots = resolveShots();
  if (shots.length === 0) {
    console.log("\n✓ Nothing to capture — all shots present on disk.\n");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    storageState: STATE_PATH,
    colorScheme: "dark",
    deviceScaleFactor: 2, // retina-quality PNGs
  });
  await forceDarkMode(context);
  const page = await context.newPage();

  console.log(`\n▸ Capturing ${shots.length} view(s) at ${VIEWPORT.width}×${VIEWPORT.height} @2x\n`);

  for (let i = 0; i < shots.length; i++) {
    await captureOne(page, shots[i]!, i, shots.length);
  }

  await browser.close();
  console.log(`\n✓ Saved to ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
