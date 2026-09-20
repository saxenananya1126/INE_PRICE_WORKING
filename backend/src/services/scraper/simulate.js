// Makes the store's failure handling VISIBLE on camera. Does nothing unless SIMULATE is set.
//
//   SIMULATE=slow   the price API answers 6 seconds late, on every attempt
//   SIMULATE=fail   the price API is down (HTTP 503) during attempt 1 only; attempt 2 works
//   SIMULATE=both   slow on every attempt, and down during attempt 1
//
// PowerShell:  $env:SIMULATE="fail"; node scripts/testScraper.js 660

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRICE_URL = /\/api\/products\/\d+\/price/;

async function applySimulation(page, { mode, attempt, log = console.log }) {
    if (!mode) return;

    const slow = mode === "slow" || mode === "both";
    const down = (mode === "fail" || mode === "both") && attempt === 1;

    await page.route(PRICE_URL, async (route) => {
        if (slow) {
            log("[SIMULATION] holding the price response back for 6 seconds...");
            await sleep(6000);
        }
        if (down) {
            log("[SIMULATION] price API answering HTTP 503 (simulated outage)");
            return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "simulated outage" })
            });
        }
        return route.continue();
    });

    log(`[SIMULATION] mode "${mode}" is active for attempt ${attempt}`);
}

module.exports = { applySimulation };