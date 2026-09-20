// Uses the live backend unless VITE_API_URL says otherwise (e.g. http://localhost:4000 for a local backend).
const BASE = (import.meta.env.VITE_API_URL || "https://ine-price.onrender.com").replace(/\/+$/, "");

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  tracked: () => request("/api/tracked"),
  track: (productId) => request("/api/track", { method: "POST", body: JSON.stringify({ productId }) }),
  untrack: (productId) => request(`/api/track/${productId}`, { method: "DELETE" }),
  history: (productId) => request(`/api/products/${productId}/history?limit=500`),
  logs: (productId) => request(`/api/products/${productId}/logs?limit=100`),
  scrapeNow: (productId) => request(`/api/products/${productId}/scrape`, { method: "POST" }),
  // trigger tells the log why it happened: "manual" (button) or "auto" (dashboard found old data)
  scrapeAll: (trigger = "manual") => request("/api/scrape-all", { method: "POST", body: JSON.stringify({ trigger }) })
};