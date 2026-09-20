// backend/src/services/scraper/cookies.js
//
// handleCookies(page) waits for the consent banner, clicks ACCEPT (or DECLINE),
// and verifies the banner is gone before returning.
//
// Self-test on a fresh context:  node src/services/scraper/cookies.js

const PRODUCT_URL = "https://demo.inelabteamdev.com/product/881";

const LABELS = {
  accept: {
    loose: /accept|agree|allow/i, // for real buttons (low false-positive risk)
    strict: /^\s*(accept|agree|allow)(\s+(all|cookies))*\s*$/i, // for bare text nodes
    aria: "accept",
  },
  decline: {
    loose: /decline|reject|deny/i,
    strict: /^\s*(decline|reject|deny)(\s+(all|cookies))*\s*$/i,
    aria: "decline",
  },
};

const BANNER_TEXT = /we use cookies|use of cookies/i;
const firstLine = (err) => String(err && err.message ? err.message : err).split("\n")[0];

/**
 * One locator that matches the consent control however it is built:
 *   real <button>, <a>, role=button, a plain <div>/<span> with the text, or an aria-label.
 * `root` can be `page` or a frameLocator (if the banner turns out to live in an iframe).
 */
function consentControl(root, action) {
  const l = LABELS[action];
  return root
    .getByRole("button", { name: l.loose })
    .or(root.getByRole("link", { name: l.loose }))
    .or(root.getByText(l.strict)) // catches <div>/<span>/<a> without a semantic role
    .or(root.locator(`[aria-label*="${l.aria}" i]`))
    .first();
}

async function handleCookies(
  page,
  { action = "accept", root = page, timeout = 15_000, log = console.log } = {}
) {
  const tag = `[cookies:${action}]`;
  const t0 = Date.now();
  const control = consentControl(root, action);

  // 1. WAIT for the banner. (count() does not wait; this does.)
  try {
    await control.waitFor({ state: "visible", timeout });
  } catch {
    log(`${tag} no consent control appeared within ${timeout}ms; continuing (already consented, or banner not shown)`);
    return { status: "not_shown", ms: Date.now() - t0 };
  }
  log(`${tag} banner detected after ${Date.now() - t0}ms`);

  const target = await control
    .evaluate((el) => `<${el.tagName.toLowerCase()}> "${(el.innerText || el.textContent || "").trim()}"`)
    .catch(() => "(element changed while inspecting)");
  log(`${tag} target: ${target}`);

  // 2. CLICK with escalating fallbacks, and 3. VERIFY after each one.
  const strategies = [
    ["normal click", () => control.click({ timeout: 5_000 })],
    ["force click", () => control.click({ timeout: 3_000, force: true })],
    ["DOM click()", () => control.evaluate((el) => el.click(), undefined, { timeout: 3_000 })],
  ];

  for (const [name, run] of strategies) {
    try {
      await run();
      // gone = detached OR not visible. If nothing matches any more, this resolves at once.
      await control.waitFor({ state: "hidden", timeout: 3_000 });
      log(`${tag} ${name} -> banner gone`);

      // secondary check: the banner sentence itself should be gone too (soft check)
      await root
        .getByText(BANNER_TEXT)
        .first()
        .waitFor({ state: "hidden", timeout: 2_000 })
        .catch(() => log(`${tag} warning: banner text still visible after click`));

      return { status: action === "accept" ? "accepted" : "declined", method: name, ms: Date.now() - t0 };
    } catch (err) {
      log(`${tag} ${name} did not work: ${firstLine(err)}`);
    }
  }

  throw new Error(`${tag} banner was visible but could not be dismissed`);
}

/**
 * Optional safety net for a banner that appears LATE or comes back after navigation.
 * Playwright calls the handler automatically before any click/fill/assertion whenever
 * the control is visible. Needs Playwright >= 1.42. It does not run during plain waitFor().
 */
async function installCookieGuard(page, { action = "accept", root = page } = {}) {
  const control = consentControl(root, action);
  await page.addLocatorHandler(control, async () => {
    await control.click({ timeout: 5_000 });
  });
}

module.exports = { handleCookies, installCookieGuard, consentControl };

// ---------------- self-test ----------------
if (require.main === module) {
  (async () => {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext(); // fresh: no stored consent
      const page = await context.newPage();
      await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });
      console.log("Page loaded.");

      const result = await handleCookies(page);
      console.log("result:", result);

      const reveal = page.getByText(/reveal price/i).first();
      const ok = await reveal
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      console.log(`REVEAL PRICE visible: ${ok}`);
      await page.waitForTimeout(1500);
    } finally {
      await browser.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}