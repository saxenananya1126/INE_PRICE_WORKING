// Usage (from backend):
//   node scripts/testScraper.js            -> product 881
//   node scripts/testScraper.js 660        -> product 660
//   node scripts/testScraper.js https://demo.inelabteamdev.com/product/660

const { scrapeWithRetry } = require("../src/services/scraper/retry");
const { formatResult } = require("../src/services/scraper/scraper");

const BASE = "https://demo.inelabteamdev.com";
const input = process.argv[2] || "881";
const PRODUCT_URL = /^https?:\/\//i.test(input) ? input : `${BASE}/product/${parseInt(input, 10)}`;

async function main() {
    try {
        const result = await scrapeWithRetry(PRODUCT_URL, 3);

        console.log("\n" + formatResult(result));
        console.log(`\nOutcome: ${result.outcome} (${result.attempts} attempt${result.attempts > 1 ? "s" : ""})`);

    } catch (error) {
        console.error("\n========== SCRAPER FAILED ==========");
        console.error(error.message);
        if (error.attemptLog) {
            for (const a of error.attemptLog) {
                console.error(`  attempt ${a.attempt}: ${a.outcome} in ${a.ms}ms${a.error ? " - " + a.error : ""}`);
            }
        }
    }
}

main();