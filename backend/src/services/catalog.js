// Copies the store's product list into Supabase so search is a fast database query.
// The store rate-limits (HTTP 429), so requests go one at a time with a pause and back off.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 6) {
    let last;
    for (let i = 1; i <= tries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (res.status === 429 || res.status >= 500) {
                const retryAfter = parseFloat(res.headers.get("retry-after"));
                const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** (i - 1);
                last = new Error(`HTTP ${res.status}`);
                await sleep(Math.min(wait, 15_000));
                continue;
            }
            if (res.status === 404) {
                const notFound = new Error("HTTP 404");
                notFound.status = 404;
                throw notFound; // not worth retrying
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            if (e.status === 404) throw e;
            last = e;
            await sleep(500 * i);
        } finally {
            clearTimeout(timer);
        }
    }
    throw last;
}

const toRow = (p) => ({
    id: p.id,
    slug: p.slug || null,
    name: p.name,
    brand: p.brand || null,
    category: p.category || null,
    sku: p.sku || null,
    description: p.description || null,
    updated_at: new Date().toISOString()
});

// Looks one product up directly in the store (used when it is missing from the catalog table).
// Returns a catalog row, or null if the store has no such product.
async function fetchProductFromStore(base, id) {
    try {
        const p = await fetchJson(`${base}/api/product/${id}`, 4);
        if (!p || p.id !== id || !p.name) return null;
        return toRow(p);
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }
}

// The store's catalog pages OVERLAP: paging through all 50 pages returns 1000 rows but only ~650
// different products (some appear on several pages, others on none). So the sync has two steps:
//   1. read every page (fast, gets most products)
//   2. look up each missing product id (1..total) one by one, until the catalog is complete
// It is safe to run again: it only fetches what is still missing.
function createCatalogSync({ store, base, log = console.log, pauseMs = 300, lookupPauseMs = 350 }) {
    let running = false;

    async function sync() {
        if (running) return { started: false };
        running = true;
        try {
            const first = await fetchJson(`${base}/api/catalog?page=1&pageSize=20`);
            if (!first || !Array.isArray(first.items) || typeof first.pages !== "number") {
                throw new Error("Unexpected catalog response shape");
            }
            const total = Number.isInteger(first.total) ? first.total : first.pages * 20;

            // step 1: the pages
            await store.upsertCatalog(first.items.map(toRow));
            for (let p = 2; p <= first.pages; p++) {
                await sleep(pauseMs);
                const data = await fetchJson(`${base}/api/catalog?page=${p}&pageSize=20`);
                await store.upsertCatalog(data.items.map(toRow));
                if (p % 10 === 0) log(`catalog sync: page ${p}/${first.pages}`);
            }

            // step 2: fill the gaps
            const have = new Set(await store.catalogIds());
            const missing = [];
            for (let id = 1; id <= total; id++) if (!have.has(id)) missing.push(id);
            log(`pages listed ${have.size} of ${total} products; looking up the other ${missing.length} one by one...`);

            let filled = 0;
            let batch = [];
            const notFound = [];
            const failed = [];
            const flush = async () => {
                if (!batch.length) return;
                await store.upsertCatalog(batch);
                filled += batch.length;
                batch = [];
            };

            for (let i = 0; i < missing.length; i++) {
                await sleep(lookupPauseMs);
                try {
                    const row = await fetchProductFromStore(base, missing[i]);
                    if (row) batch.push(row);
                    else notFound.push(missing[i]);
                } catch (e) {
                    failed.push(missing[i]); // network trouble: a later run will retry it
                }
                if (batch.length >= 25) await flush();
                if ((i + 1) % 50 === 0) log(`catalog sync: looked up ${i + 1}/${missing.length}`);
            }
            await flush();

            const result = { started: true, listedByPages: have.size, filledIn: filled, notInStore: notFound.length, failed: failed.length };
            log(`catalog sync finished: ${JSON.stringify(result)}`);
            if (failed.length) log(`${failed.length} lookups failed; run the sync again to retry them.`);
            return result;
        } finally {
            running = false;
        }
    }

    return { sync, isRunning: () => running };
}

module.exports = { createCatalogSync, fetchProductFromStore };