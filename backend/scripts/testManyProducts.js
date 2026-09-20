// backend/scripts/testManyProducts.js
//
// Runs the REAL scraper on a sample of products and prints a pass/fail report.
//
//   node scripts/testManyProducts.js                  12 products, spread across categories
//   node scripts/testManyProducts.js --count 30
//   node scripts/testManyProducts.js --ids 881,58,989 specific products
//   node scripts/testManyProducts.js --out my-report.json
//
// PowerShell, no browser window (like Render):   $env:HEADLESS="1"; node scripts/testManyProducts.js
// (needs the one-line change in browser.js: headless: process.env.HEADLESS === "1")
//
// The report is saved after every product, so Ctrl+C never loses what already ran.

const fs = require("fs");
const { scrapeWithRetry } = require("../src/services/scraper/retry");

const BASE = process.env.STORE_BASE_URL || "https://demo.inelabteamdev.com";

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const COUNT = parseInt(arg("count", "12"), 10);
const IDS = arg("ids", null);
const OUT = arg("out", "scrape-report.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inr = (n) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "n/a");

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---------------- catalog (plain HTTP, no browser) ----------------

async function fetchJson(url, tries = 6) {
    let last;
    for (let i = 1; i <= tries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });

            // rate limited or server error: wait (Retry-After if given, else exponential) and retry
            if (res.status === 429 || res.status >= 500) {
                const retryAfter = parseFloat(res.headers.get("retry-after"));
                const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** (i - 1);
                last = new Error(`HTTP ${res.status}`);
                await sleep(Math.min(wait, 15_000));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            last = e;
            await sleep(500 * i);
        } finally {
            clearTimeout(timer);
        }
    }
    throw last;
}

// The store rate-limits (HTTP 429), so: one request at a time, with a pause, and only as
// many catalog pages as the sample needs (each page has 20 mixed-category products).
async function loadCatalog(count) {
    const first = await fetchJson(`${BASE}/api/catalog?page=1&pageSize=20`);
    const wanted = Math.min(first.pages, Math.max(6, Math.ceil(count / 3)));
    const pages = shuffle(Array.from({ length: first.pages - 1 }, (_, i) => i + 2)).slice(0, wanted - 1);

    const items = [...first.items];
    for (const p of pages) {
        await sleep(400);
        const data = await fetchJson(`${BASE}/api/catalog?page=${p}&pageSize=20`);
        items.push(...data.items);
    }
    return { items, pagesLoaded: pages.length + 1, totalPages: first.pages };
}

// round-robin over categories so the sample covers different kinds of products
function pickSample(items, count) {
    const byCat = new Map();
    for (const it of items) {
        if (!byCat.has(it.category)) byCat.set(it.category, []);
        byCat.get(it.category).push(it);
    }
    for (const list of byCat.values()) shuffle(list);
    const cats = shuffle([...byCat.keys()]);
    const out = [];
    while (out.length < count && out.length < items.length) {
        for (const c of cats) {
            const it = byCat.get(c).pop();
            if (it) out.push(it);
            if (out.length >= count) break;
        }
    }
    return out;
}

// ---------------- checks on a successful result ----------------

// Extra sanity checks. Anything listed here does NOT fail the scrape, it marks the
// result as "worth a manual look".
function flagsFor(r) {
    const flags = [];
    if (Number.isFinite(r.mrp) && r.price > r.mrp) flags.push("price > MRP");

    const pct = parseInt(r.discount, 10);
    if (r.price && r.mrp && Number.isFinite(pct)) {
        const actual = Math.round((1 - r.price / r.mrp) * 100);
        if (Math.abs(actual - pct) > 1) flags.push(`discount says ${pct}% but numbers give ${actual}%`);
    }

    if (r.apiPrice == null) {
        flags.push("no /price API response captured");
    } else if (!new RegExp(`(?<![\\d.])${r.price}(?!\\d)`).test(JSON.stringify(r.apiPrice))) {
        flags.push("page price not found in API response");
    }
    return flags;
}

// ---------------- run one product with console output muted ----------------

async function runOne(entry) {
    const url = `${BASE}/product/${entry.id}`;
    const started = Date.now();
    const logs = [];
    const realLog = console.log;
    console.log = (...a) => logs.push(a.map(String).join(" "));
    try {
        const r = await scrapeWithRetry(url, 3);
        return { ok: true, r, logs, ms: Date.now() - started };
    } catch (e) {
        return { ok: false, error: e.message, attemptLog: e.attemptLog || [], logs, ms: Date.now() - started };
    } finally {
        console.log = realLog;
    }
}

// ---------------- main ----------------

(async () => {
    let sample;
    if (IDS) {
        sample = IDS.split(",").map((s) => ({ id: parseInt(s.trim(), 10), name: "?", category: "?" }));
    } else {
        console.log("Loading catalog...");
        const { items, pagesLoaded, totalPages } = await loadCatalog(COUNT);
        sample = pickSample(items, COUNT);
        console.log(
            `Loaded ${items.length} products from ${pagesLoaded} of ${totalPages} catalog pages. ` +
            `Testing ${sample.length}, spread across categories.\n`
        );
    }

    const results = [];
    const startedAt = new Date().toISOString();

    for (let i = 0; i < sample.length; i++) {
        const entry = sample[i];
        const run = await runOne(entry);
        const secs = (run.ms / 1000).toFixed(1);
        const label = `[${i + 1}/${sample.length}] #${entry.id} ${entry.name} (${entry.category})`;

        let row;
        if (run.ok) {
            const r = run.r;
            r.attempts = r.attempts || 1;
            r.outcome = r.outcome || (r.attempts > 1 ? "retried" : "success"); // in case an older retry.js is in use
            const flags = flagsFor(r);
            row = {
                id: entry.id, name: r.name || entry.name, category: r.category || entry.category,
                outcome: r.outcome, attempts: r.attempts, attemptLog: r.attemptLog,
                price: r.price, mrp: r.mrp, discount: r.discount, stock: r.stock, stockQty: r.stockQty,
                seller: r.seller, flags, seconds: +secs
            };
            console.log(
                `${label}  ${r.outcome.toUpperCase()} (${r.attempts} attempt${r.attempts > 1 ? "s" : ""})  ` +
                `${inr(r.price)} / MRP ${inr(r.mrp)}  ${r.stockQty ?? ""} ${r.stock}  ${secs}s` +
                (flags.length ? `  !! ${flags.join("; ")}` : "")
            );
        } else {
            row = {
                id: entry.id, name: entry.name, category: entry.category,
                outcome: "failed", attempts: run.attemptLog.length, attemptLog: run.attemptLog,
                error: run.error, flags: [], seconds: +secs, lastLogs: run.logs.slice(-8)
            };
            console.log(`${label}  FAILED  ${run.error}  ${secs}s`);
        }
        results.push(row);

        // save after every product
        fs.writeFileSync(OUT, JSON.stringify({ startedAt, base: BASE, results }, null, 2));
        if (i < sample.length - 1) await sleep(1000);
    }

    // ---------------- summary ----------------
    const count = (f) => results.filter(f).length;
    const first = count((r) => r.outcome === "success");
    const retried = count((r) => r.outcome === "retried");
    const failed = count((r) => r.outcome === "failed");
    const flagged = count((r) => r.flags && r.flags.length);
    const avg = (results.reduce((s, r) => s + r.seconds, 0) / results.length).toFixed(1);

    console.log("\n========== SUMMARY ==========");
    console.log(`Products tested:          ${results.length}`);
    console.log(`Succeeded first attempt:  ${first}`);
    console.log(`Succeeded after retry:    ${retried}`);
    console.log(`Failed all attempts:      ${failed}`);
    console.log(`Success rate:             ${(((first + retried) / results.length) * 100).toFixed(0)}%`);
    console.log(`Flagged for a look:       ${flagged}`);
    console.log(`Average time per product: ${avg}s`);

    // what went wrong on individual attempts (digits collapsed so similar errors group together)
    const reasons = new Map();
    for (const r of results) {
        for (const a of r.attemptLog || []) {
            if (a.outcome === "failed" && a.error) {
                const key = a.error.replace(/\d+/g, "N").slice(0, 110);
                reasons.set(key, (reasons.get(key) || 0) + 1);
            }
        }
    }
    if (reasons.size) {
        console.log("\nAttempt failures by reason:");
        [...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}x  ${k}`));
    }

    if (failed) {
        console.log("\nProducts that failed every attempt:");
        results.filter((r) => r.outcome === "failed").forEach((r) => console.log(`  #${r.id} ${r.name}: ${r.error}`));
    }
    console.log(`\nFull report saved to ${OUT}`);
    process.exitCode = failed ? 1 : 0;
})().catch((e) => {
    console.error("Test run crashed:", e.message);
    process.exit(1);
});