// All database access lives here (Supabase / Postgres). The rest of the app only talks to
// this small interface, so it is easy to test and easy to read.

const { createClient } = require("@supabase/supabase-js");

function createStore({ url, key }) {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const ok = ({ data, error }, what) => {
        if (error) throw new Error(`${what}: ${error.message}`);
        return data;
    };

    // keep only characters that are safe inside a PostgREST filter
    const cleanToken = (t) => t.replace(/[^a-z0-9.\-]/gi, "");

    return {
        // ---------- catalog / search ----------
        async catalogCount() {
            const { count, error } = await db.from("catalog_products").select("id", { count: "exact", head: true });
            if (error) throw new Error(`catalogCount: ${error.message}`);
            return count || 0;
        },

        // every product id currently in the catalog table (read in blocks of 1000)
        async catalogIds() {
            const ids = [];
            for (let from = 0; ; from += 1000) {
                const rows = ok(
                    await db.from("catalog_products").select("id").order("id").range(from, from + 999),
                    "catalogIds"
                );
                ids.push(...rows.map((r) => r.id));
                if (rows.length < 1000) break;
            }
            return ids;
        },

        async upsertCatalog(rows) {
            ok(await db.from("catalog_products").upsert(rows, { onConflict: "id" }), "upsertCatalog");
        },

        // partial or full name: every word typed must appear in name, brand, category or SKU
        async searchCatalog(q, limit = 20) {
            const tokens = q.toLowerCase().split(/\s+/).map(cleanToken).filter(Boolean).slice(0, 6);
            if (!tokens.length) return [];

            let query = db.from("catalog_products").select("id,slug,name,brand,category,sku");
            for (const t of tokens) {
                const parts = [`name.ilike.%${t}%`, `brand.ilike.%${t}%`, `category.ilike.%${t}%`, `sku.ilike.%${t}%`];
                if (/^\d{1,9}$/.test(t)) parts.push(`id.eq.${t}`); // typing "660" finds product 660
                query = query.or(parts.join(",")); // separate .or() calls are ANDed together
            }
            return ok(await query.order("name").limit(limit), "searchCatalog");
        },

        async getCatalogProduct(id) {
            return ok(
                await db.from("catalog_products").select("id,slug,name,brand,category,sku").eq("id", id).maybeSingle(),
                "getCatalogProduct"
            );
        },

        // ---------- tracked products ----------
        async trackProduct(p) {
            // upsert only touches the columns given, so a custom interval_minutes is kept
            return ok(
                await db
                    .from("tracked_products")
                    .upsert(
                        { product_id: p.id, slug: p.slug, name: p.name, brand: p.brand, category: p.category, sku: p.sku, active: true },
                        { onConflict: "product_id" }
                    )
                    .select()
                    .single(),
                "trackProduct"
            );
        },

        async untrack(productId) {
            ok(await db.from("tracked_products").delete().eq("product_id", productId), "untrack");
        },

        async listTracked() {
            return ok(await db.from("tracked_overview").select("*").order("created_at", { ascending: false }), "listTracked");
        },

        async getTracked(productId) {
            return ok(await db.from("tracked_overview").select("*").eq("product_id", productId).maybeSingle(), "getTracked");
        },

        // ---------- history and logs ----------
        async insertHistory(row) {
            ok(await db.from("price_history").insert(row), "insertHistory");
        },

        async insertLog(row) {
            const first = await db.from("scrape_logs").insert(row);
            // if the "trigger" column has not been added to the table yet, save the log without it rather than lose it
            if (first.error && /trigger/i.test(first.error.message) && "trigger" in row) {
                const { trigger, ...withoutTrigger } = row;
                ok(await db.from("scrape_logs").insert(withoutTrigger), "insertLog");
                return;
            }
            ok(first, "insertLog");
        },

        // last few prices per product (oldest first), for the small trend lines on the dashboard.
        // One query: the most recent 1000 history rows across the given products, grouped in memory.
        async recentPrices(productIds, perProduct = 12) {
            const out = new Map();
            if (!productIds.length) return out;
            const rows = ok(
                await db
                    .from("price_history")
                    .select("product_id,price,scraped_at")
                    .in("product_id", productIds)
                    .order("scraped_at", { ascending: false })
                    .limit(1000),
                "recentPrices"
            );
            for (const r of rows) {
                const list = out.get(r.product_id) || [];
                if (list.length < perProduct) {
                    list.push(r.price);
                    out.set(r.product_id, list);
                }
            }
            for (const [id, list] of out) out.set(id, list.reverse());
            return out;
        },

        async getHistory(productId, limit = 500) {
            const rows = ok(
                await db
                    .from("price_history")
                    .select("*")
                    .eq("product_id", productId)
                    .order("scraped_at", { ascending: false })
                    .limit(limit),
                "getHistory"
            );
            return rows.reverse(); // oldest first, ready for a chart
        },

        async getLogs(productId, limit = 100) {
            return ok(
                await db
                    .from("scrape_logs")
                    .select("*")
                    .eq("product_id", productId)
                    .order("started_at", { ascending: false })
                    .limit(limit),
                "getLogs"
            );
        }
    };
}

module.exports = { createStore };