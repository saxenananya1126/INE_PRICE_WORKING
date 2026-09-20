// backend/scripts/inspectPrice.js
// Usage (from backend):  node scripts/inspectPrice.js 400
//
// Opens the product, reveals the price like the scraper does, then prints exactly how the price
// element is built: its HTML, and for every node inside it the text, attributes, position,
// visibility and any text drawn by CSS (::before / ::after). Paste the output if a price is wrong.

const { createBrowser } = require("../src/services/scraper/browser");
const { attachNetworkLogging } = require("../src/services/scraper/networkLogger");
const { handleCookies } = require("../src/services/scraper/cookies");
const { clickAndConfirmReveal } = require("../src/services/scraper/revealProbe");
const { humanRevealClick } = require("../src/services/scraper/humanClick");
const { readPriceBlockInPage } = require("../src/services/scraper/scraper");

const BASE = "https://demo.inelabteamdev.com";
const input = process.argv[2] || "881";
const URL = /^https?:\/\//i.test(input) ? input : `${BASE}/product/${parseInt(input, 10)}`;
const id = (URL.match(/\/product\/(\d+)/) || [])[1] || "x";

// runs inside the page
function describePriceElement(cls) {
    const block = document.querySelector("div.price-block");
    if (!block) return { error: "no div.price-block" };
    const out =
        (cls && cls.priceValue && block.querySelector("." + CSS.escape(cls.priceValue))) ||
        block.querySelector("output");
    if (!out) return { error: "no price element found" };

    const pseudo = (el, which) => {
        const c = getComputedStyle(el, which).content;
        return c === "none" || c === "normal" ? null : c;
    };
    const info = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
            tag: el.tagName.toLowerCase(),
            class: el.className || null,
            ownText: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") || null,
            attrs: [...el.attributes].filter((a) => a.name !== "class" && a.name !== "style").map((a) => `${a.name}=${a.value}`),
            display: cs.display, position: cs.position, opacity: cs.opacity,
            fontSize: cs.fontSize, visibility: cs.visibility, order: cs.order,
            box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            before: pseudo(el, "::before"),
            after: pseudo(el, "::after")
        };
    };
    return {
        html: out.outerHTML.replace(/\s+/g, " ").slice(0, 4000),
        nodes: [out, ...out.querySelectorAll("*")].slice(0, 60).map(info)
    };
}

(async () => {
    const { browser, page } = await createBrowser();
    try {
        const api = attachNetworkLogging(page);
        console.log(`Opening ${URL}`);
        await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
        await handleCookies(page, { timeout: 8000, log: () => {} });

        const priceBlock = page.locator("div.price-block");
        const revealButton = page.locator("button.btn-primary[aria-label*='Reveal']");
        await revealButton.waitFor({ state: "visible", timeout: 8000 });
        await clickAndConfirmReveal(page, () => humanRevealClick(page, priceBlock, revealButton, () => {}));
        await page.locator("div.price-block.price-success").waitFor({ state: "visible", timeout: 10000 });

        console.log("Waiting 6s so the price can finish updating...");
        await page.waitForTimeout(6000);

        const cls = api.layout && api.layout.classes ? api.layout.classes : null;
        console.log("\n=== layout classes ===\n", JSON.stringify(cls));

        const d = await page.evaluate(describePriceElement, cls);
        console.log("\n=== price element HTML ===\n" + (d.html || d.error));
        console.log("\n=== nodes inside the price element ===");
        (d.nodes || []).forEach((n, i) => console.log(i, JSON.stringify(n)));

        console.log("\n=== what the scraper's reader returns ===");
        console.log(JSON.stringify(await page.evaluate(readPriceBlockInPage, cls), null, 2));

        const file = `price-debug-${id}.png`;
        await priceBlock.screenshot({ path: file });
        console.log(`\nScreenshot saved: ${file}`);
        console.log("Price API response:", JSON.stringify(api.price));
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error("inspectPrice failed:", e.message);
    process.exit(1);
});