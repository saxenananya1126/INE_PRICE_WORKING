const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { snapshot: memorySnapshot } = require("./services/memory");

// constant-time comparison of the cron secret
function secretOk(provided, expected) {
    if (!provided || !expected) return false;
    const a = crypto.createHash("sha256").update(String(provided)).digest();
    const b = crypto.createHash("sha256").update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
}

function createApp({ store, runner, catalogSync, fetchStoreProduct, cronSecret, frontendOrigin = "", maxTracked = 25, manualCooldownSeconds = 60, scrapeAllCooldownSeconds = 600 }) {
    const app = express();
    app.use(express.json());

    const origins = frontendOrigin.split(",").map((s) => s.trim()).filter(Boolean);
    app.use(cors({ origin: origins.length ? origins : true }));

    // async route errors become a JSON 500 instead of crashing or hanging
    const wrap = (fn) => (req, res) =>
        Promise.resolve(fn(req, res)).catch((err) => {
            console.error(`${req.method} ${req.path}:`, err.message);
            res.status(500).json({ error: "Internal error" });
        });

    const parseId = (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : null;
    };
    const parseLimit = (v, fallback, max) => Math.min(Math.max(parseInt(v, 10) || fallback, 1), max);

    const requireCron = (req, res, next) =>
        secretOk(req.get("x-cron-secret"), cronSecret) ? next() : res.status(401).json({ error: "Unauthorized" });

    // ---------------------------------------------------------------- health
    app.get("/api/health", (req, res) => {
        res.json({ ok: true, queued: runner.pendingCount(), memory: memorySnapshot(), time: new Date().toISOString() });
    });

    // ---------------------------------------------------------------- search
    app.get("/api/search", wrap(async (req, res) => {
        const q = String(req.query.q || "").trim();
        if (q.length < 2 && !/^\d+$/.test(q)) {
            return res.status(400).json({ error: "Type at least 2 characters" });
        }
        const results = await store.searchCatalog(q, 20);
        if (!results.length && (await store.catalogCount()) === 0) {
            // first start: the product list has not been copied from the store yet
            if (catalogSync && !catalogSync.isRunning()) {
                catalogSync.sync().catch((e) => console.error("catalog sync failed:", e.message));
            }
            return res.status(503).json({ error: "catalog_loading", message: "The product list is loading, try again in about a minute." });
        }
        res.json(results);
    }));

    // ---------------------------------------------------------------- tracking
    app.post("/api/track", wrap(async (req, res) => {
        const id = parseId(req.body && req.body.productId);
        if (!id) return res.status(400).json({ error: "productId (a positive integer) is required" });

        const tracked = await store.listTracked();
        const existing = tracked.find((t) => t.product_id === id);
        if (existing) return res.json({ product: existing, alreadyTracked: true });
        if (tracked.length >= maxTracked) {
            return res.status(409).json({ error: `Limit of ${maxTracked} tracked products reached` });
        }

        let product = await store.getCatalogProduct(id);
        if (!product && fetchStoreProduct) {
            // not in our copy of the catalog (yet): ask the store itself, and remember the answer
            let fromStore;
            try {
                fromStore = await fetchStoreProduct(id);
            } catch (e) {
                console.error(`store lookup for product ${id} failed:`, e.message);
                return res.status(502).json({ error: "Could not look this product up in the store right now, try again shortly" });
            }
            if (fromStore) {
                await store.upsertCatalog([fromStore]);
                product = fromStore;
            }
        }
        if (!product) return res.status(404).json({ error: "No such product in the store" });

        const row = await store.trackProduct(product);
        const queued = runner.enqueue(row, "first"); // first scrape right away, so the chart is not empty
        res.status(201).json({ product: row, firstScrape: queued ? "queued" : "already queued" });
    }));

    app.get("/api/tracked", wrap(async (req, res) => {
        const rows = await store.listTracked();
        let trend = new Map();
        try {
            trend = await store.recentPrices(rows.map((r) => r.product_id));
        } catch (e) {
            console.error("recentPrices failed (dashboard trend lines will be empty):", e.message);
        }
        res.json(rows.map((r) => ({ ...r, recent_prices: trend.get(r.product_id) || [] })));
    }));

    // "Refresh all" button: queue every tracked product. Cooldown so it cannot hammer the store.
    let lastScrapeAll = 0;
    app.post("/api/scrape-all", wrap(async (req, res) => {
        const waitMs = scrapeAllCooldownSeconds * 1000 - (Date.now() - lastScrapeAll);
        if (waitMs > 0) {
            return res.status(429).json({ error: "Everything was refreshed very recently", retryAfterSeconds: Math.ceil(waitMs / 1000) });
        }
        // the dashboard says whether a person pressed the button (manual) or it noticed old data (auto)
        const trigger = req.body && req.body.trigger === "auto" ? "auto" : "manual";
        const summary = await runner.runCycle({ trigger });
        lastScrapeAll = Date.now();
        res.status(202).json(summary);
    }));

    app.delete("/api/track/:productId", wrap(async (req, res) => {
        const id = parseId(req.params.productId);
        if (!id) return res.status(400).json({ error: "Invalid product id" });
        await store.untrack(id);
        res.json({ ok: true });
    }));

    // ---------------------------------------------------------------- history and log
    app.get("/api/products/:productId/history", wrap(async (req, res) => {
        const id = parseId(req.params.productId);
        if (!id) return res.status(400).json({ error: "Invalid product id" });
        if (!(await store.getTracked(id))) return res.status(404).json({ error: "This product is not tracked" });
        res.json(await store.getHistory(id, parseLimit(req.query.limit, 200, 1000)));
    }));

    app.get("/api/products/:productId/logs", wrap(async (req, res) => {
        const id = parseId(req.params.productId);
        if (!id) return res.status(400).json({ error: "Invalid product id" });
        if (!(await store.getTracked(id))) return res.status(404).json({ error: "This product is not tracked" });
        res.json(await store.getLogs(id, parseLimit(req.query.limit, 100, 500)));
    }));

    // manual "scrape now" (with a cooldown so the button cannot hammer the store)
    app.post("/api/products/:productId/scrape", wrap(async (req, res) => {
        const id = parseId(req.params.productId);
        if (!id) return res.status(400).json({ error: "Invalid product id" });

        const product = await store.getTracked(id);
        if (!product) return res.status(404).json({ error: "This product is not tracked" });
        if (runner.isPending(id)) return res.status(409).json({ error: "This product is already queued or being scraped" });

        if (product.last_attempt_at) {
            const waitMs = manualCooldownSeconds * 1000 - (Date.now() - new Date(product.last_attempt_at).getTime());
            if (waitMs > 0) {
                return res.status(429).json({ error: "Scraped very recently", retryAfterSeconds: Math.ceil(waitMs / 1000) });
            }
        }
        runner.enqueue(product, "manual");
        res.status(202).json({ status: "queued" });
    }));

    // ---------------------------------------------------------------- cron (called by cron-job.org)
    // Responds immediately; the scraping itself runs in the background queue. cron-job.org gives
    // up after ~30 seconds, and a Render free instance can take about that long just to wake up.
    const cronScrape = [
        requireCron,
        wrap(async (req, res) => {
            const summary = await runner.runCycle({ onlyDue: req.query.due === "1" });
            res.status(202).json(summary);
        })
    ];
    app.get("/api/cron/scrape", ...cronScrape);
    app.post("/api/cron/scrape", ...cronScrape);

    const cronSync = [
        requireCron,
        wrap(async (req, res) => {
            if (!catalogSync) return res.status(501).json({ error: "Catalog sync is not configured" });
            if (catalogSync.isRunning()) return res.status(202).json({ status: "already running" });
            catalogSync.sync().catch((e) => console.error("catalog sync failed:", e.message));
            res.status(202).json({ status: "started" });
        })
    ];
    app.get("/api/cron/sync-catalog", ...cronSync);
    app.post("/api/cron/sync-catalog", ...cronSync);

    // ---------------------------------------------------------------- fallbacks
    app.use((req, res) => res.status(404).json({ error: "Not found" }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const status = err.status || 500;
        res.status(status).json({ error: status === 400 ? "Bad request" : "Internal error" });
    });

    return app;
}

module.exports = { createApp };

// ------------------------------------------------------------------ start (node src/server.js)
if (require.main === module) {
    const { getConfig } = require("./config");
    const { createStore } = require("./store");
    const { createRunner } = require("./services/runner");
    const { createCatalogSync, fetchProductFromStore } = require("./services/catalog");

    const cfg = getConfig();
    const store = createStore({ url: cfg.supabaseUrl, key: cfg.supabaseKey });
    const runner = createRunner({ store, base: cfg.storeBase });
    const catalogSync = createCatalogSync({ store, base: cfg.storeBase });

    const app = createApp({
        store,
        runner,
        catalogSync,
        fetchStoreProduct: (id) => fetchProductFromStore(cfg.storeBase, id),
        cronSecret: cfg.cronSecret,
        frontendOrigin: cfg.frontendOrigin,
        maxTracked: cfg.maxTracked
    });

    app.listen(cfg.port, () => console.log(`API listening on port ${cfg.port}`));

    // first start: copy the store's product list into Supabase in the background
    store
        .catalogCount()
        .then((n) => {
            if (n === 0) {
                console.log("Catalog is empty, syncing it in the background...");
                catalogSync.sync().catch((e) => console.error("catalog sync failed:", e.message));
            }
        })
        .catch((e) => console.error("could not check the catalog:", e.message));
}