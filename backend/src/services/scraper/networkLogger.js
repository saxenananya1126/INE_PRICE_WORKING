// Quiet by default: no headers, no bodies. It silently CAPTURES the product and price
// responses so scraper.js can print a clean summary, and it only prints a one-line
// message when an API call fails (so failures are never hidden).
//
// Set DEBUG_SCRAPER=1 to also see every API call and the price/challenge/session bodies.

const VERBOSE = process.env.DEBUG_SCRAPER === "1";

const pathOf = (url) => {
    try {
        const u = new URL(url);
        return u.pathname + u.search;
    } catch {
        return url;
    }
};

// /api/product/881 (details) is different from /api/products/881/price (price + stock)
function classify(url) {
    if (/\/api\/products\/\d+\/price/.test(url)) return "price";
    if (/\/api\/product\/\d+/.test(url)) return "product";
    if (url.includes("/api/challenge")) return "challenge";
    if (url.includes("/api/session")) return "session";
    if (url.includes("/api/layout")) return "layout";
    return null;
}

function attachNetworkLogging(page) {
    // filled in silently; scraper.js reads it
    const api = {
        product: null,
        price: null,
        challenge: null,
        session: null,
        layout: null,
        priceStatus: null
    };

    page.on("request", (request) => {
        if (!VERBOSE || !request.url().includes("/api/")) return;
        let line = `[api] -> ${request.method()} ${pathOf(request.url())}`;
        if (request.method() === "POST" && request.url().includes("/api/session")) {
            line += `  body: ${request.postData()}`;
        }
        console.log(line);
    });

    page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/api/")) return;

        const status = response.status();
        const key = classify(url);

        // errors are always shown; successes only in debug mode
        if (status >= 400 || VERBOSE) {
            console.log(`[api] <- ${status} ${response.request().method()} ${pathOf(url)}`);
        }
        if (!key) return;

        try {
            const text = await response.text();
            let body;
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }

            if (key === "price") api.priceStatus = status;
            if (status < 400) api[key] = body; // never keep an error response as data

            if (VERBOSE && (key === "price" || key === "challenge" || key === "session")) {
                console.log(`[api] ${key} body: ${text}`);
            }
        } catch (error) {
            if (VERBOSE) console.log(`[api] could not read ${key} body: ${error.message}`);
        }
    });

    page.on("requestfailed", (request) => {
        if (!request.url().includes("/api/")) return;
        const failure = request.failure();
        console.log(
            `[api] FAILED ${request.method()} ${pathOf(request.url())} ${failure ? failure.errorText : ""}`
        );
    });

    return api;
}

module.exports = {
    attachNetworkLogging
};