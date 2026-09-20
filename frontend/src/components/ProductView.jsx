import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import Badge from "./Badge";
import ScrapeLog from "./ScrapeLog";
import { PriceChart, StockChart } from "./Charts";
import { belowMrp, dateTime, inr, nextScrape, priceChange, stockLabel, timeAgo } from "../format";

const POLL_MS = 15000;

function Tile({ label, children, sub }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{children}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

export default function ProductView({ id, product, trackedLoaded, busy, onScrape, onRemove }) {
  const activeId = useRef(id);
  const [history, setHistory] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("history");
  const [asTable, setAsTable] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, l] = await Promise.all([api.history(id), api.logs(id)]);
      if (activeId.current !== id) return; // user already moved to another product
      setHistory(h);
      setLogs(l);
      setError("");
    } catch (e) {
      if (activeId.current === id) setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    activeId.current = id;
    setHistory(null);
    setLogs(null);
    setError("");
    setTab("history");
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [id, load]);

  if (!product) {
    return (
      <section className="empty">
        <h2>{trackedLoaded ? "This product is not tracked" : "Loading…"}</h2>
        {trackedLoaded && (
          <a className="btn" href="#/">
            Back to overview
          </a>
        )}
      </section>
    );
  }

  const latest = history && history.length ? history[history.length - 1] : null;
  const price = latest ? latest.price : product.latest_price;
  const mrp = latest ? latest.mrp : product.latest_mrp;
  const change = history ? priceChange(history.map((h) => h.price)) : null;
  const below = belowMrp(price, mrp);
  const inStock = latest ? latest.in_stock : product.latest_in_stock;
  const qty = latest ? latest.stock_qty : product.latest_stock_qty;

  return (
    <>
      <a className="back" href="#/">
        ← Overview
      </a>

      <section className="pv-head">
        <div>
          <div className="pv-chips">
            <span className="chip chip-cat">{product.category}</span>
            <span className={`chip ${inStock === true ? "chip-ok" : inStock === false ? "chip-bad" : "chip-idle"}`}>
              {inStock == null ? "No stock data" : stockLabel(inStock, qty)}
            </span>
          </div>
          <h1 className="pv-title">{product.name}</h1>
          <div className="muted">
            {product.brand} · SKU {product.sku} · Product #{product.product_id}
          </div>
        </div>
        <div className="pv-actions">
          <button className="btn" onClick={() => onScrape(id)} disabled={busy}>
            Scrape now
          </button>
          <button className="btn btn-outline btn-danger" onClick={() => onRemove(product)}>
            Stop tracking
          </button>
        </div>
      </section>

      {product.last_outcome === "failed" && (
        <p className="notice notice-warn">
          The latest scrape failed{product.last_error ? `: ${product.last_error}` : "."}{" "}
          {history && history.length
            ? "Nothing wrong was saved; the figures below are from the last successful scrape."
            : "Nothing has been saved for this product yet, because no scrape has succeeded so far."}
        </p>
      )}

      <section className="tiles">
        <Tile
          label="Current price"
          sub={
            change ? (
              <span className={`delta delta-${change.dir}`}>
                {change.dir === "up" ? "▲" : change.dir === "down" ? "▼" : "•"} {Math.abs(change.pct).toFixed(1)}% since previous scrape
              </span>
            ) : null
          }
        >
          <span className="big">{inr(price)}</span>
        </Tile>
        <Tile label="MRP" sub={below ? `${below}% below MRP` : null}>
          {inr(mrp)}
        </Tile>
        <Tile label="Stock">{stockLabel(inStock, qty)}</Tile>
        <Tile label="Seller">{latest?.seller || "—"}</Tile>
        <Tile label="Delivery">{latest?.delivery || "—"}</Tile>
        <Tile label="Last check" sub={product.last_attempt_at ? dateTime(product.last_attempt_at) : null}>
          <Badge outcome={product.last_outcome} /> <span className="small muted">{timeAgo(product.last_attempt_at)}</span>
        </Tile>
        <Tile label="Next scheduled scrape" sub="every 2 hours">
          {nextScrape()}
        </Tile>
      </section>

      {error && <p className="notice notice-bad">{error}</p>}

      <section className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
            Price &amp; stock history{history ? <span className="nav-count">{history.length}</span> : null}
          </button>
          <button role="tab" className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>
            Scrape log{logs ? <span className="nav-count">{logs.length}</span> : null}
          </button>
        </div>

        {tab === "history" && (
          <div className="panel-body">
            {history === null && <p className="muted">Loading…</p>}
            {history && history.length === 0 && (
              <p className="muted">
                {product.last_outcome === "failed"
                  ? "No price recorded yet: the scrape attempts so far failed (see the Scrape log tab). The next scheduled run will try again."
                  : "No price recorded yet. The first scrape is queued and takes about a minute; this page updates by itself."}
              </p>
            )}

            {history && history.length > 0 && (
              <>
                <div className="panel-row">
                  <h3>Price</h3>
                  <label className="switch">
                    <input type="checkbox" checked={asTable} onChange={(e) => setAsTable(e.target.checked)} /> Show as table
                  </label>
                </div>

                {!asTable ? (
                  <>
                    <PriceChart history={history} />
                    <h3 className="sub">Stock</h3>
                    <StockChart history={history} />
                  </>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Price</th>
                          <th>MRP</th>
                          <th>Stock</th>
                          <th>Seller</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...history].reverse().map((h) => (
                          <tr key={h.id}>
                            <td>{dateTime(h.scraped_at)}</td>
                            <td>{inr(h.price)}</td>
                            <td>{inr(h.mrp)}</td>
                            <td>{stockLabel(h.in_stock, h.stock_qty)}</td>
                            <td>{h.seller || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "log" && (
          <div className="panel-body">
            <p className="muted small">Every run is listed, including failures. Click a row to see each attempt inside it.</p>
            {logs === null ? <p className="muted">Loading…</p> : <ScrapeLog logs={logs} />}
          </div>
        )}
      </section>
    </>
  );
}
