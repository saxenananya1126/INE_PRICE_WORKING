// backend/src/services/scraper/retry.js
//
// scrapeWithRetry(url, maxAttempts) runs scrapeProduct, validates the result, retries with
// backoff, and returns an HONEST attempt log (what really happened on every attempt).
//
// Old file: rename it to retry.old.js before saving this one, so nothing is lost.

const { scrapeProduct } = require("./scraper");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KNOWN_STOCK = new Set(["in_stock", "out_of_stock"]);

// Returns a list of problems. Empty list = safe to store.
function validateResult(r) {
    if (!r || typeof r !== "object") return ["no result object returned"];

    const problems = [];
    if (r.status !== "success") problems.push(`status=${r.status}`);
    if (!Number.isFinite(r.price) || r.price <= 0) problems.push(`price=${r.price}`);
    if (!KNOWN_STOCK.has(r.stock)) problems.push(`stock=${r.stock}`);
    if (Number.isFinite(r.mrp) && Number.isFinite(r.price) && r.price > r.mrp) {
        problems.push(`price ${r.price} is above MRP ${r.mrp}`);
    }
    return problems;
}

async function scrapeWithRetry(url, maxAttempts = 3, { baseDelayMs = 2000 } = {}) {
    const attemptLog = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`Scrape attempt ${attempt}/${maxAttempts}`);
        const startedAt = new Date().toISOString();
        const t0 = Date.now();

        try {
            const result = await scrapeProduct(url);

            const problems = validateResult(result);
            if (problems.length) {
                // show exactly what was rejected (without the long fields)
                const { specs, description, apiPrice, ...brief } = result || {};
                console.log("Rejected result:", JSON.stringify(brief));
                throw new Error(`Invalid result (${problems.join("; ")})`);
            }

            attemptLog.push({ attempt, startedAt, ms: Date.now() - t0, outcome: "success" });
            return {
                ...result,
                attempts: attempt,
                attemptLog,
                outcome: attempt === 1 ? "success" : "retried"
            };
        } catch (error) {
            attemptLog.push({
                attempt,
                startedAt,
                ms: Date.now() - t0,
                outcome: "failed",
                error: error.message
            });
            console.log(`Attempt ${attempt} failed: ${error.message}`);

            if (attempt < maxAttempts) {
                const delay = baseDelayMs * 2 ** (attempt - 1); // 2000, 4000, ...
                console.log(`Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }
        }
    }

    const last = attemptLog[attemptLog.length - 1];
    const err = new Error(`Scrape failed after ${maxAttempts} attempts. Last error: ${last.error}`);
    err.attemptLog = attemptLog;
    err.outcome = "failed";
    throw err;
}

module.exports = { scrapeWithRetry, validateResult };