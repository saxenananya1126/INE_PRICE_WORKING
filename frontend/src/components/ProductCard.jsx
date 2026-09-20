import Badge from "./Badge";
import Sparkline from "./Sparkline";
import { belowMrp, inr, priceChange, stockLabel, timeAgo } from "../format";

export default function ProductCard({ product: p, onOpen, onScrape, onRemove, busy }) {
  const change = priceChange(p.recent_prices);
  const below = belowMrp(p.latest_price, p.latest_mrp);
  const hasPrice = p.latest_price != null;
  const stockCls = p.latest_in_stock === true ? "chip-ok" : p.latest_in_stock === false ? "chip-bad" : "chip-idle";

  return (
    <article
      className="pcard"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p.product_id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(p.product_id)}
    >
      <div className="pcard-top">
        <span className="chip chip-cat">{p.category}</span>
        <span className={`chip ${stockCls}`}>{p.latest_in_stock == null ? "No stock data" : stockLabel(p.latest_in_stock, p.latest_stock_qty)}</span>
      </div>

      <h3 className="pcard-name">{p.name}</h3>
      <div className="muted small">
        {p.brand} · {p.sku}
      </div>

      {hasPrice ? (
        <div className="pcard-price">
          <div>
            <div className="price">{inr(p.latest_price)}</div>
            {p.latest_mrp ? (
              <div className="mrp-line">
                MRP <s>{inr(p.latest_mrp)}</s>
                {below ? ` · −${below}%` : ""}
              </div>
            ) : null}
          </div>
          <div className="pcard-trend">
            <Sparkline values={p.recent_prices} tone={change ? change.dir : undefined} />
            {change && (
              <span className={`delta delta-${change.dir}`}>
                {change.dir === "up" ? "▲" : change.dir === "down" ? "▼" : "•"} {Math.abs(change.pct).toFixed(1)}% since last scrape
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="waiting">Waiting for the first successful scrape…</div>
      )}

      {p.last_outcome === "failed" && hasPrice && <div className="pcard-warn">The latest scrape failed. This is the last good price.</div>}

      <div className="pcard-foot">
        <span className="foot-status">
          <Badge outcome={p.last_outcome} />
          <span className="muted small">{p.last_attempt_at ? timeAgo(p.last_attempt_at) : "in the queue"}</span>
        </span>
        <span className="pcard-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-small" onClick={() => onScrape(p.product_id)} disabled={busy}>
            Scrape now
          </button>
          <button className="btn btn-small btn-quiet" onClick={() => onRemove(p)}>
            Remove
          </button>
        </span>
      </div>
    </article>
  );
}
