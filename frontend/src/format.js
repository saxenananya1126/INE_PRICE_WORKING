export const inr = (n) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "—");

export const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export const seconds = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);

export function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The cron job runs at minute 0 of every 2nd hour, Asia/Kolkata (UTC+5:30): 00:00, 02:00, 04:00 ... IST
export function nextScheduledRun(now = Date.now()) {
  const IST = 5.5 * 3600 * 1000;
  const STEP = 2 * 3600 * 1000;
  const shifted = now + IST; // wall-clock milliseconds in IST
  return Math.floor(shifted / STEP) * STEP + STEP - IST;
}

export function nextScrapeParts() {
  const at = nextScheduledRun();
  const m = Math.max(1, Math.round((at - Date.now()) / 60000));
  const when = new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const inText = m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
  return { inText, when: `${when} IST` };
}

export function nextScrape() {
  const { inText, when } = nextScrapeParts();
  return `${inText} (${when})`;
}

export function stockLabel(inStock, qty) {
  if (inStock === true) return qty != null ? `In stock · ${qty}` : "In stock";
  if (inStock === false) return "Out of stock";
  return "—";
}

// change between the last two readings (values are oldest first)
export function priceChange(values) {
  if (!values || values.length < 2) return null;
  const prev = values[values.length - 2];
  const cur = values[values.length - 1];
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  return { pct, dir: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat" };
}

export const belowMrp = (price, mrp) => (price && mrp && mrp > price ? Math.round((1 - price / mrp) * 100) : null);
