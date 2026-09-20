require("dotenv").config();

function need(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
    return value;
}

// SUPABASE_URL must be just the project address, e.g. https://abcdxyz.supabase.co
// Tidy the usual copy-paste mistakes (quotes, spaces, trailing slash, /rest/v1) and refuse anything else.
function cleanSupabaseUrl(raw) {
    const url = raw.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`SUPABASE_URL is not a valid URL: "${raw}". It should look like https://abcdxyz.supabase.co`);
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error(
            `SUPABASE_URL must be only the project address (https://abcdxyz.supabase.co), but it has extra parts: "${raw}". ` +
            `Copy the Project URL from Supabase -> Project Settings -> Data API, not a dashboard link.`
        );
    }
    return parsed.origin;
}

function getConfig() {
    return {
        port: parseInt(process.env.PORT || "4000", 10),
        supabaseUrl: cleanSupabaseUrl(need("SUPABASE_URL")),
        supabaseKey: need("SUPABASE_SERVICE_ROLE_KEY").trim().replace(/^["']|["']$/g, ""),
        cronSecret: need("CRON_SECRET"),
        storeBase: process.env.STORE_BASE_URL || "https://demo.inelabteamdev.com",
        frontendOrigin: process.env.FRONTEND_ORIGIN || "",
        maxTracked: parseInt(process.env.MAX_TRACKED || "25", 10)
    };
}

module.exports = { getConfig };