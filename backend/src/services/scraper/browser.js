const { chromium } = require("playwright");

// HEADLESS=1  -> no window (needed on Render, which has no screen)
// not set     -> visible Chrome, for watching the scraper and for the screen recording
const HEADLESS = process.env.HEADLESS === "1";

async function createBrowser() {
    const browser = await chromium.launch({
        headless: HEADLESS,
        // these two flags are needed to run Chromium inside a container; harmless to skip locally
        args: HEADLESS ? ["--no-sandbox", "--disable-dev-shm-usage"] : []
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    return {
        browser,
        context,
        page
    };
}

module.exports = {
    createBrowser
};