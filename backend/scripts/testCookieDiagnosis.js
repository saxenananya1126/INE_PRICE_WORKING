// Change this line:
// const { createBrowser } = require("../backend/src/services/scraper/browser");

// To this:
const { createBrowser } = require("../src/services/scraper/browser");

async function diagnose() {
    const { browser, page } = await createBrowser();
    try {
        console.log("Navigating to target page...");
        await page.goto("https://demo.inelabteamdev.com/product/881", { waitUntil: "networkidle" });

        // Wait a few seconds for async banners to appear
        await page.waitForTimeout(3000);

        console.log("\n========== IFRAME INSPECTION ==========");
        const frames = page.frames();
        console.log(`Total frames found: ${frames.length}`);
        frames.forEach((f, idx) => console.log(`[Frame ${idx}] URL: ${f.url()}`));

        console.log("\n========== ELEMENT INSPECTION (ACCEPT/DECLINE) ==========");
        // Search across main page and frames for elements containing accept or decline
        const results = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            const matches = [];
            while (walker.nextNode()) {
                const el = walker.currentNode;
                const text = el.innerText ? el.innerText.trim() : "";
                if (/^(accept|decline)$/i.test(text) || /accept cookies/i.test(text)) {
                    matches.push({
                        tagName: el.tagName,
                        id: el.id,
                        className: el.className,
                        text: text,
                        visible: el.offsetParent !== null,
                        rect: el.getBoundingClientRect()
                    });
                }
            }
            return matches;
        });

        console.log("Found matching elements:", JSON.stringify(results, null, 2));

    } catch (err) {
        console.error("Diagnostic error:", err);
    } finally {
        await browser.close();
    }
}

diagnose();