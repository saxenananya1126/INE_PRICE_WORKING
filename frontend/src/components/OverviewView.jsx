import ProductCard from "./ProductCard";
import SummaryStrip from "./SummaryStrip";

export default function OverviewView({ tracked, busyIds, onOpen, onScrape, onRemove }) {
  return (
    <>
      <div className="page-title">
        <h1>Overview</h1>
        <p className="muted">Latest price and stock for every product you track. Open a product for its full history and scrape log.</p>
      </div>

      <SummaryStrip tracked={tracked} />

      {tracked === null && <p className="muted">Loading your products…</p>}

      {tracked && tracked.length === 0 && (
        <section className="empty">
          <h2>You are not tracking anything yet</h2>
          <p className="muted">Search the store, pick a product, and it will be scraped right away and then every 2 hours.</p>
          <a className="btn" href="#/find">
            Find products
          </a>
        </section>
      )}

      {tracked && tracked.length > 0 && (
        <div className="grid">
          {tracked.map((p) => (
            <ProductCard key={p.product_id} product={p} busy={busyIds.has(p.product_id)} onOpen={onOpen} onScrape={onScrape} onRemove={onRemove} />
          ))}
        </div>
      )}
    </>
  );
}
