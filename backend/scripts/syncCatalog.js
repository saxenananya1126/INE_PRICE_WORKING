// Copies the store's product list (1000 products) into Supabase so search works.
// Run once after creating the tables:   node scripts/syncCatalog.js
const { getConfig } = require("../src/config");
const { createStore } = require("../src/store");
const { createCatalogSync } = require("../src/services/catalog");

(async () => {
    const cfg = getConfig();
    const store = createStore({ url: cfg.supabaseUrl, key: cfg.supabaseKey });
    const { sync } = createCatalogSync({ store, base: cfg.storeBase });
    console.log("Syncing catalog (about 50 requests, one at a time)...");
    const result = await sync();
    console.log(result);
})().catch((e) => {
    console.error("Catalog sync failed:", e.message);
    process.exit(1);
});