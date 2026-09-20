const fs = require("fs");
const path = require("path");
const { createBrowser } = require("./browser");
const { attachNetworkLogging } = require("./networkLogger");
const { handleCookies } = require("./cookies");
const { attachPageDiagnostics, probeBeforeClick, clickAndConfirmReveal } = require("./revealProbe");
const { humanRevealClick } = require("./humanClick");
const { applySimulation } = require("./simulate");

// Set DEBUG_SCRAPER=1 to see cookie / mouse / probe / network details. Off by default.
const debug = process.env.DEBUG_SCRAPER === "1" ? console.log : () => {};

// All waits are multiplied by TIMEOUT_SCALE. 1 on a laptop; the free Render instance has very little
// CPU, so pages load and scripts run much slower there and the same waits need to be longer (set 2).
const SCALE = parseFloat(process.env.TIMEOUT_SCALE) || 1;
const T = (ms) => Math.round(ms * SCALE);

// counts attempts within one retry sequence; only used by the SIMULATE demo mode
let simulationAttempt = 0;

/* ---------------------------------------------------------------------------------------
   Reading the price block.

   The store's price block is full of traps (seen in DevTools):
     - <span class="price-value" style="display:none">   hidden decoy price
     - <span class="amount" data-price="true" ...>        hidden decoy price
     - <output class="... pv-m4">                         the REAL price, split into pieces
     - <span class="mr-m4"> (struck through)              the MRP, NOT the price
     - "Updating…" while the value is still changing (price is dimmed, opacity .45)
   Reading document.body.innerText with a regex therefore returns the MRP or a decoy.

   So: use the class names from /api/layout (they change per variant), and read only text
   that is really visible, in the order it is drawn on screen.
--------------------------------------------------------------------------------------- */

// Runs INSIDE the page (serialised by page.evaluate): must be self-contained.
function readPriceBlockInPage(cls) {
    const ZW = /[\u200B-\u200D\u2060\uFEFF]/g;
    const block = document.querySelector("div.price-block");
    if (!block) return { error: "no div.price-block on the page" };

    // Text a person can actually see, in the order it is drawn (left to right, top to bottom).
    // Skips display:none, visibility:hidden, opacity:0, font-size:0, zero-size text and text pushed
    // off the page. Also includes text drawn by CSS (::before / ::after content), which is not
    // in the DOM as text but is visible on screen.
    const visibleText = (root) => {
        if (!root) return null;
        const pageWidth = document.documentElement.clientWidth;
        const parts = [];

        // every element from `el` up to (not including) `stopAt` must be rendered
        const rendered = (el, stopAt) => {
            for (let e = el; e && e !== stopAt; e = e.parentElement) {
                const cs = getComputedStyle(e);
                if (
                    cs.display === "none" ||
                    cs.visibility === "hidden" ||
                    parseFloat(cs.opacity) === 0 ||
                    parseFloat(cs.fontSize) === 0
                ) return false;
            }
            return true;
        };
        // on the page: not zero-size and not thrown far off to the left/right/top (decoy trick).
        // NOTE: text that overflows the element's own box is still visible, so it is kept.
        const onPage = (r) =>
            r.width >= 0.5 && r.height >= 0.5 &&
            r.right > -2 && r.left < pageWidth + 2 && r.bottom + window.scrollY > -2;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const raw = (n.textContent || "").replace(ZW, "");
            if (!raw.trim()) continue;
            if (!rendered(n.parentElement, root)) continue;

            const range = document.createRange();
            range.selectNodeContents(n);
            const r = range.getBoundingClientRect();
            if (!onPage(r)) continue;

            parts.push({
                t: raw.replace(/\s+/g, " ").trim(),
                lead: /^\s/.test(raw),
                trail: /\s$/.test(raw),
                x: r.left,
                right: r.right,
                cy: (r.top + r.bottom) / 2,
                h: r.height
            });
        }

        // text drawn by CSS: content: "642" / attr(data-x) on ::before and ::after
        for (const el of [root, ...root.querySelectorAll("*")]) {
            for (const which of ["::before", "::after"]) {
                const ps = getComputedStyle(el, which);
                const m = /^"([\s\S]*)"$|^'([\s\S]*)'$/.exec(ps.content || "");
                if (!m) continue;
                const text = (m[1] != null ? m[1] : m[2]).replace(ZW, "");
                if (!text.trim()) continue;
                if (
                    ps.display === "none" || ps.visibility === "hidden" ||
                    parseFloat(ps.opacity) === 0 || parseFloat(ps.fontSize) === 0
                ) continue;
                if (!rendered(el, root.parentElement)) continue;

                const r = el.getBoundingClientRect();
                if (!onPage(r)) continue;
                const edge = which === "::before" ? r.left : r.right;
                parts.push({
                    t: text.replace(/\s+/g, " ").trim(),
                    lead: /^\s/.test(text),
                    trail: /\s$/.test(text),
                    x: edge,
                    right: edge,
                    cy: (r.top + r.bottom) / 2,
                    h: r.height
                });
            }
        }

        parts.sort((a, b) => {
            if (Math.abs(a.cy - b.cy) > 0.5 * Math.min(a.h, b.h)) return a.cy - b.cy; // different row
            return a.x - b.x; // same row: left to right
        });

        let out = "";
        let prev = null;
        for (const p of parts) {
            if (prev) {
                const sameRow = Math.abs(p.cy - prev.cy) < 0.6 * p.h;
                if (!sameRow || prev.trail || p.lead || p.x - prev.right > 2) out += " ";
            }
            out += p.t;
            prev = p;
        }
        return out.replace(/\s+/g, " ").trim();
    };

    const c = cls || {};
    const find = (className, fallbackSelector) => {
        const byClass = className ? block.querySelector("." + CSS.escape(className)) : null;
        return byClass || (fallbackSelector ? block.querySelector(fallbackSelector) : null);
    };

    const priceEl = find(c.priceValue, "output");
    const mrpEl = find(c.mrp, "del, s");
    const discountEl = find(c.badge, null);
    const stockEl = find(c.stock, null);
    const sellerEl = find(c.seller, null);
    const deliveryEl = find(c.delivery, null);
    const ratingEl = find(c.rating, null);

    const blockText = block.innerText || ""; // innerText already leaves out display:none text
    const loaded = /Loaded in\s+(\d+)\s+attempt/i.exec(blockText);

    return {
        priceText: visibleText(priceEl),
        mrpText: visibleText(mrpEl),
        discountText: visibleText(discountEl),
        stockText: visibleText(stockEl),
        sellerTitle: sellerEl ? sellerEl.getAttribute("title") : null,
        sellerText: visibleText(sellerEl),
        deliveryText: visibleText(deliveryEl),
        ratingText: visibleText(ratingEl),
        updating: /updating/i.test(blockText),
        priceOpacity: priceEl ? parseFloat(getComputedStyle(priceEl).opacity) : null,
        loadedIn: loaded ? parseInt(loaded[1], 10) : null,
        found: { price: !!priceEl, mrp: !!mrpEl, discount: !!discountEl, stock: !!stockEl, seller: !!sellerEl }
    };
}

// Wait until the price has stopped changing: no "Updating…", not dimmed, and the same values
// on two reads in a row. Never returns a half-updated value.
async function readSettledPriceBlock(page, layout, { timeout = 10_000, interval = 400 } = {}) {
    const cls = layout && layout.classes ? layout.classes : null;
    const deadline = Date.now() + timeout;
    let previousKey = null;
    let last = null;

    while (Date.now() < deadline) {
        last = await page.evaluate(readPriceBlockInPage, cls);

        const ready =
            last && !last.error && last.priceText && last.stockText &&
            !last.updating && (last.priceOpacity == null || last.priceOpacity > 0.6);

        if (ready) {
            const key = [last.priceText, last.mrpText, last.discountText, last.stockText].join("|");
            if (key === previousKey) return last;
            previousKey = key;
        } else {
            previousKey = null;
        }
        await page.waitForTimeout(interval);
    }

    let reason;
    if (!last) reason = "could not read the price block";
    else if (last.error) reason = last.error;
    else if (!last.found.price) reason = "visible price element not found (layout classes changed?)";
    else if (!last.priceText) reason = "price element is empty";
    else if (last.updating) reason = "price was still \"Updating…\"";
    else if (!last.stockText) reason = "stock text not found";
    else reason = "price kept changing";
    throw new Error(`Price not settled after ${timeout / 1000}s: ${reason}`);
}

function parseSnapshot(s) {
    const amount = (t) => {
        const m = /\d[\d,]*/.exec((t || "").replace(/\s+/g, "")); // "₹ 4 , 748" -> "₹4,748"
        return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
    };

    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(s.discountText || "");
    const stockStr = s.stockText || "";
    const qtyMatch = /(\d[\d,]*)\s*left/i.exec(stockStr) || /(\d[\d,]*)\s*in stock/i.exec(stockStr);

    return {
        price: amount(s.priceText),
        mrp: amount(s.mrpText),
        discount: pct ? `${pct[1]}% off` : null,
        stock: /out of stock|sold out/i.test(stockStr)
            ? "out_of_stock"
            : /in stock|\bleft\b/i.test(stockStr) ? "in_stock" : "unknown",
        stockQty: qtyMatch ? parseInt(qtyMatch[1].replace(/,/g, ""), 10) : null,
        stockText: stockStr || null,
        seller: s.sellerTitle || (s.sellerText ? s.sellerText.replace(/^sold by\s*/i, "") : null) || null,
        delivery: s.deliveryText || null,
        ratings: s.ratingText || null,
        priceText: s.priceText ? s.priceText.replace(/\s+/g, "") : null,
        siteReportedAttempts: s.loadedIn
    };
}

// A click sometimes does not start the reveal, for example because the page's script is not ready yet
// on a slow machine. Try again on the same page before giving up on the whole page load.
async function revealWithRetries(page, doClick, { tries = 3, challengeWindowMs = T(5000), priceWindowMs = T(25000) } = {}) {
    for (let i = 1; i <= tries; i++) {
        try {
            return await clickAndConfirmReveal(page, doClick, { timeout: challengeWindowMs, priceTimeout: priceWindowMs });
        } catch (e) {
            const notStarted = /did not fire \/api\/challenge/.test(e.message);
            if (!notStarted || i === tries) throw e;
            debug(`reveal click ${i} did not start the flow, trying again`);
            await page.waitForTimeout(1000);
        }
    }
}

// Turns a list of [phaseName, timestamp] marks into "launch 1.8s | page load 3.1s | ..." (where the time went)
function formatTimings(marks) {
    const parts = [];
    for (let i = 1; i < marks.length; i++) {
        parts.push(`${marks[i][0]} ${((marks[i][1] - marks[i - 1][1]) / 1000).toFixed(1)}s`);
    }
    parts.push(`total ${((marks[marks.length - 1][1] - marks[0][1]) / 1000).toFixed(1)}s`);
    return parts.join(" | ");
}

// Prints the raw HTML of the price area (only used when a value looks wrong), so the exact
// structure can be inspected.
async function dumpPriceBlock(page) {
    try {
        const html = await page.evaluate(() => {
            const el = document.querySelector("div.price-main") || document.querySelector("div.price-block");
            return el ? el.outerHTML : null;
        });
        console.log("[price block html]", html ? html.replace(/\s+/g, " ").slice(0, 3500) : "(not found)");
    } catch (e) {
        console.log("[price block html] could not read:", e.message);
    }
}

async function scrapeProduct(url) {
    const marks = [["start", Date.now()]];
    const mark = (name) => marks.push([name, Date.now()]);
    const { browser, page } = await createBrowser();
    mark("browser launch");

    try {
        simulationAttempt += 1;
        await applySimulation(page, { mode: process.env.SIMULATE, attempt: simulationAttempt });

        const api = attachNetworkLogging(page); // silent capture of product / price / layout responses
        attachPageDiagnostics(page, debug);

        // Extract product ID from URL (e.g., 868 from .../product/868)
        const productIdMatch = url.match(/\/product\/(\d+)/);
        const productId = productIdMatch ? parseInt(productIdMatch[1], 10) : null;

        console.log(`Opening: ${url}`);
        await page.goto(url, { waitUntil: "networkidle", timeout: T(30000) });
        mark("page load");

        // 1. Cookies
        const cookieResult = await handleCookies(page, { log: debug, timeout: T(8000) });
        console.log(`Cookies: ${cookieResult.status}`);
        mark("cookie banner");

        // 2. Find Price Block & Reveal Button
        const priceBlock = page.locator("div.price-block");
        const revealButton = page.locator("button.btn-primary[aria-label*='Reveal']");
        await revealButton.waitFor({ state: "visible", timeout: T(8000) });

        // 3. Hover + press like a person, and confirm the reveal flow really started
        console.log("Revealing price...");
        await probeBeforeClick(page, undefined, debug);
        const reveal = await revealWithRetries(page, () => humanRevealClick(page, priceBlock, revealButton, debug));

        mark("hover + click + API");

        // 4. Wait for the success state, then for the price to stop updating
        try {
            await page.locator("div.price-block.price-success").waitFor({ state: "visible", timeout: T(10000) });
        } catch {
            throw new Error(
                `Price did not appear within ${T(10000) / 1000}s (the price API's first answer was HTTP ${reveal && reveal.priceStatus})`
            );
        }
        mark("price shown");
        const snapshot = await readSettledPriceBlock(page, api.layout, { timeout: T(10000) });
        mark("price settled");
        console.log("Price revealed.");
        console.log(`Timing: ${formatTimings(marks)}`);

        // optional proof: picture of the price block at the moment the value was read
        // (set SCREENSHOT_DIR, testManyProducts.js does this for you)
        let screenshotFile = null;
        if (process.env.SCREENSHOT_DIR) {
            fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
            screenshotFile = path.join(process.env.SCREENSHOT_DIR, `product-${productId}.png`);
            await priceBlock.screenshot({ path: screenshotFile }).catch(() => {
                screenshotFile = null;
            });
        }

        // 5. Parse what is visibly on screen
        const productData = parseSnapshot(snapshot);
        console.log(
            `Extracted: price=${productData.price} mrp=${productData.mrp} discount=${productData.discount} ` +
            `stock=${productData.stockQty != null ? productData.stockQty + " " : ""}${productData.stock}`
        );
        debug("[snapshot]", JSON.stringify(snapshot));

        // never return empty/incorrect data: fail with the exact reason instead
        const problems = [];
        if (!Number.isFinite(productData.price) || productData.price <= 0) problems.push(`price=${productData.price}`);
        if (productData.stock === "unknown") problems.push("stock unknown");
        if (Number.isFinite(productData.mrp) && productData.price > productData.mrp) {
            problems.push(`price ${productData.price} is above MRP ${productData.mrp}`);
        }
        // real prices here are roughly 50-70% of MRP; far lower almost always means digits were missed
        if (Number.isFinite(productData.mrp) && productData.price > 0 && productData.price < productData.mrp * 0.2) {
            problems.push(
                `price ${productData.price} is implausibly low against MRP ${productData.mrp} ` +
                `(digits probably missed, raw text "${snapshot.priceText}")`
            );
            await dumpPriceBlock(page);
        }
        if (problems.length) {
            throw new Error(`Extraction incomplete after reveal (${problems.join(", ")})`);
        }

        // independent cross-check against the store's own /price response (soft: it may have refreshed)
        const apiText = api.price == null ? null : JSON.stringify(api.price);
        const crossCheck =
            apiText == null
                ? "no-api"
                : new RegExp(`(?<![\\d.])${productData.price}(?!\\d)`).test(apiText) ? "match" : "mismatch";
        debug("[cross-check]", crossCheck, apiText);

        const p = api.product || {};

        // 6. Final result
        simulationAttempt = 0;
        return {
            productId,
            status: "success",
            name: p.name || null,
            brand: p.brand || null,
            category: p.category || null,
            sku: p.sku || null,
            description: p.description || null,
            specs: p.specs || null,
            ...productData,
            crossCheck,
            screenshotFile,
            apiPrice: api.price, // raw /price response, kept for later use
            attempts: 1, // overwritten by retry.js with the real number
            attemptLog: [{ attempt: 1, outcome: "success" }]
        };

    } finally {
        await browser.close();
    }
}

// ---------- clean printout: product details + price, nothing else ----------

const inr = (n) => (typeof n === "number" && !Number.isNaN(n) ? `₹${n.toLocaleString("en-IN")}` : "n/a");
const label = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function formatResult(res) {
    const r = res && res.result ? res.result : res; // tolerate a wrapper object
    const lines = [];

    lines.push("========== PRODUCT ==========");
    lines.push(`${r.name || "(name unavailable)"}  [ID ${r.productId}]`);
    lines.push(
        [r.brand && `Brand: ${r.brand}`, r.category && `Category: ${r.category}`, r.sku && `SKU: ${r.sku}`]
            .filter(Boolean)
            .join("  |  ")
    );
    lines.push("");
    lines.push(`Price:     ${inr(r.price)}`);
    lines.push(`MRP:       ${inr(r.mrp)}${r.discount ? `  (${r.discount})` : ""}`);
    lines.push(
        `Stock:     ${r.stockQty != null ? r.stockQty + " " : ""}${(r.stock || "unknown").replace(/_/g, " ").toUpperCase()}`
    );
    if (r.seller) lines.push(`Seller:    ${r.seller}`);
    if (r.delivery) lines.push(`Delivery:  ${r.delivery}`);
    if (r.ratings) lines.push(`Ratings:   ${r.ratings}`);

    if (r.description) {
        lines.push("", r.description);
    }
    if (r.specs) {
        lines.push("", "Specifications:");
        for (const [k, v] of Object.entries(r.specs)) lines.push(`  ${label(k)}: ${v}`);
    }

    if (r.crossCheck === "mismatch") {
        lines.push(
            "",
            `NOTE: the price ${inr(r.price)} was not found in the store's own /price response. ` +
                `It may have refreshed since, but double-check it against the page.`
        );
    }

    // informational only: the store's own discount label is not always in sync with its prices
    const pct = parseFloat(r.discount);
    if (r.price && r.mrp && Number.isFinite(pct)) {
        const actual = Math.round((1 - r.price / r.mrp) * 100);
        if (Math.abs(actual - pct) > 1) {
            lines.push(
                "",
                `NOTE: the page's discount label says ${pct}% but ${inr(r.price)} vs MRP ${inr(r.mrp)} is ${actual}%. ` +
                    `Price and MRP are read from their own elements; the label may be out of sync.`
            );
        }
    }

    return lines.join("\n");
}

module.exports = {
    scrapeProduct,
    handleCookies,
    formatResult,
    // exported for tests
    readPriceBlockInPage,
    readSettledPriceBlock,
    parseSnapshot,
    revealWithRetries
};