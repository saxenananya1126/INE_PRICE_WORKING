import { nextScrapeParts } from "../format";

function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

export default function SummaryStrip({ tracked }) {
  const list = tracked || [];
  const inStock = list.filter((p) => p.latest_in_stock === true).length;
  const outOfStock = list.filter((p) => p.latest_in_stock === false).length;
  const failing = list.filter((p) => p.last_outcome === "failed").length;
  const waiting = list.filter((p) => p.latest_price == null).length;
  const next = nextScrapeParts();

  return (
    <section className="summary" aria-label="Summary">
      <Stat label="Tracked products" value={list.length} hint={waiting ? `${waiting} waiting for first scrape` : "all have a price"} />
      <Stat label="In stock" value={inStock} hint="at the latest scrape" tone="ok" />
      <Stat label="Out of stock" value={outOfStock} hint="at the latest scrape" tone={outOfStock ? "warn" : ""} />
      <Stat label="Needs attention" value={failing} hint={failing ? "latest scrape failed" : "all latest scrapes worked"} tone={failing ? "bad" : ""} />
      <Stat label="Next scheduled scrape" value={next.inText} hint={`${next.when} · every 2 hours`} />
    </section>
  );
}
