// backend/src/services/scraper/revealProbe.js
// Three small helpers. They don't touch your retry logic.
//
//   attachPageDiagnostics(page)               -> call once after creating the page
//   probeBeforeClick(page, point?)            -> call right before "Clicking Reveal price..."
//   clickAndConfirmReveal(page, clickFn)      -> wraps your existing click code

function attachPageDiagnostics(page, log = console.log) {
  page.on("pageerror", (e) => log(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") log(`[console.error] ${m.text()}`);
  });
  page.on("requestfailed", (r) =>
    log(`[requestfailed] ${r.method()} ${r.url()} ${(r.failure() && r.failure().errorText) || ""}`)
  );
}

/**
 * Prints what is really under the click point, whether the button is enabled,
 * and whether the cookie sentence is still on the page.
 * `point` = the {x, y} your code is about to click; omit it to use the button's centre.
 */
async function probeBeforeClick(page, point, log = console.log) {
  const info = await page.evaluate((pt) => {
    const d = (el) =>
      !el
        ? null
        : el.tagName.toLowerCase() +
          (el.id ? "#" + el.id : "") +
          (typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/).join(".")
            : "");

    // smallest element whose text mentions "reveal price"
    const btn =
      [...document.querySelectorAll("button,[role=button],a,div,span")]
        .filter((e) => /reveal price/i.test(e.innerText || ""))
        .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;

    const r = btn ? btn.getBoundingClientRect() : null;
    const p = pt || (r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null);
    const top = p ? document.elementFromPoint(p.x, p.y) : null;

    return {
      revealButton: d(btn),
      revealDisabled: btn ? !!btn.disabled || btn.getAttribute("aria-disabled") === "true" : null,
      clickPoint: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
      elementAtClickPoint: d(top),
      clickLandsOnButton: !!(btn && top && (top === btn || btn.contains(top))),
      cookieTextStillOnPage: /we use cookies|use of cookies/i.test(document.body.innerText),
      viewport: { w: innerWidth, h: innerHeight },
    };
  }, point || null);

  log("[probe]", JSON.stringify(info, null, 2));
  return info;
}

/**
 * Runs your click, then checks the reveal flow really started:
 *   click -> GET /api/challenge -> ... -> GET /api/products/:id/price
 * Throws a specific error for each failure mode instead of a generic selector timeout:
 *   - no /api/challenge  => the click did nothing (blocked / not registered / gated)
 *   - no /price response => flow started but the API was slow or failed
 * Returns { priceStatus } so a 4xx/5xx can be logged as a failed attempt.
 */
async function clickAndConfirmReveal(page, clickFn, { timeout = 8_000, priceTimeout = timeout * 2 } = {}) {
  const challenge = page.waitForRequest((r) => r.url().includes("/api/challenge"), { timeout });
  const price = page.waitForResponse((r) => /\/api\/products\/\d+\/price/.test(r.url()), {
    timeout: priceTimeout, // the store's price API can be slow on purpose: allow much longer than the click window
  });
  challenge.catch(() => {}); // avoid unhandled rejections if clickFn throws first
  price.catch(() => {});

  await clickFn();

  try {
    await challenge;
  } catch {
    throw new Error(
      "Reveal click did not fire /api/challenge (click not registered or blocked; is the cookie banner still up?)"
    );
  }
  try {
    const res = await price;
    return { priceStatus: res.status() };
  } catch {
    throw new Error("/api/challenge fired but no /price response arrived (slow or failed API)");
  }
}

module.exports = { attachPageDiagnostics, probeBeforeClick, clickAndConfirmReveal };