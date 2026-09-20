// Runs scrapes, one at a time, and writes the results to the database honestly:
//   - price_history gets a row ONLY when the scrape succeeded and was validated
//   - scrape_logs gets a row for EVERY run: success, retried or failed
//
// One at a time on purpose: each scrape opens a Chromium, and the free Render instance has
// little memory. It also keeps the load on the (rate-limited) store low.

const { startPeakSampler } = require("./memory");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createRunner({ store, base, scrape, log = console.log, pauseMs = 2000, maxAttempts = 3, dueSlackMinutes = 10 }) {
    // required lazily so tests can pass a fake scraper without loading Playwright
    const scrapeFn = scrape || require("./scraper/retry").scrapeWithRetry;

    const pending = new Map(); // product id -> what asked for the scrape; queued or running
    let chain = Promise.resolve();

    async function scrapeAndStore(product, trigger) {
        const startedAt = new Date();
        const productId = product.product_id;

        let result = null;
        let outcome;
        let attempts;
        let attemptLog;
        let errorMessage = null;

        const memory = startPeakSampler();
        try {
            result = await scrapeFn(`${base}/product/${productId}`, maxAttempts);
            attempts = result.attempts || 1;
            outcome = result.outcome || (attempts > 1 ? "retried" : "success");
            attemptLog = result.attemptLog || [];
        } catch (err) {
            outcome = "failed";
            attemptLog = err.attemptLog || [];
            attempts = attemptLog.length || maxAttempts;
            errorMessage = err.message;
        }

        const peakMb = memory.stop();

        // 1. price history: only for a validated success
        if (result) {
            try {
                await store.insertHistory({
                    product_id: productId,
                    price: result.price,
                    mrp: result.mrp ?? null,
                    discount_label: result.discount ?? null,
                    in_stock: result.stock === "in_stock",
                    stock_qty: result.stockQty ?? null,
                    seller: result.seller ?? null,
                    delivery: result.delivery ?? null,
                    scraped_at: new Date().toISOString()
                });
            } catch (err) {
                // the scrape worked but the value was not saved: say so, do not pretend success
                outcome = "failed";
                errorMessage = `Scraped OK but saving the price failed: ${err.message}`;
                result = null;
            }
        }

        // 2. the log always gets a row
        const finishedAt = new Date();
        try {
            await store.insertLog({
                trigger: trigger || null, // scheduled | manual | auto | first
                product_id: productId,
                started_at: startedAt.toISOString(),
                finished_at: finishedAt.toISOString(),
                outcome,
                attempts,
                duration_ms: finishedAt - startedAt,
                error_message: errorMessage,
                attempt_log: attemptLog,
                price: result ? result.price : null
            });
        } catch (err) {
            log(`could not write scrape log for product ${productId}: ${err.message}`);
        }

        log(
            `scrape #${productId}: ${outcome} (${attempts} attempt${attempts === 1 ? "" : "s"})` +
            `${peakMb != null ? `, peak memory ~${peakMb} MB` : ""}${errorMessage ? " - " + errorMessage : ""}`
        );
        return { outcome, attempts, errorMessage };
    }

    // put a product in the queue (ignored if it is already queued or running)
    // trigger says WHY this scrape happens, and is written to the log:
    //   scheduled (the cron job), manual (a button), auto (dashboard found old data), first (just started tracking)
    function enqueue(product, trigger = "manual") {
        if (pending.has(product.product_id)) return false;
        pending.set(product.product_id, trigger);
        chain = chain.then(async () => {
            try {
                await scrapeAndStore(product, trigger);
            } catch (err) {
                log(`unexpected error scraping #${product.product_id}: ${err.message}`);
            } finally {
                pending.delete(product.product_id);
            }
            await sleep(pauseMs);
        });
        return true;
    }

    function isDue(p, now = Date.now()) {
        if (p.active === false) return false;
        if (!p.last_attempt_at) return true;
        const dueAfterMs = ((p.interval_minutes || 120) - dueSlackMinutes) * 60_000;
        return now - new Date(p.last_attempt_at).getTime() >= dueAfterMs;
    }

    // Called by the cron endpoint. The cron job itself IS the schedule (every 2 hours), so by default every
    // active tracked product is queued. Filtering by "last attempt" would let a manual scrape made shortly
    // before the cron run push a product's next scrape out to the run after (up to 4 hours old).
    // Pass onlyDue: true to queue just the products whose own interval has passed.
    async function runCycle({ onlyDue = false, trigger = "scheduled" } = {}) {
        const tracked = await store.listTracked();
        const active = tracked.filter((p) => p.active !== false);
        const due = onlyDue ? active.filter((p) => isDue(p)) : active;
        const queued = due.filter((p) => enqueue(p, trigger)).length;
        return { tracked: tracked.length, due: due.length, queued };
    }

    return {
        enqueue,
        runCycle,
        isPending: (id) => pending.has(id),
        pendingCount: () => pending.size,
        idle: () => chain // resolves when the queue is empty (used in tests)
    };
}

module.exports = { createRunner };