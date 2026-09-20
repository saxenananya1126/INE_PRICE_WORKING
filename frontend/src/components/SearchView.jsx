import { useEffect, useState } from "react";
import { api } from "../api";

const IDEAS = ["AR glasses", "Headphones", "Blender", "Air fryer", "Trainer", "Monitor"];

export default function SearchView({ trackedIds, onTrack, onOpen }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = nothing searched yet
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  // search 350 ms after the user stops typing
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setResults(null);
      setMessage("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setMessage("");
      try {
        const rows = await api.search(q);
        if (!cancelled) setResults(rows);
      } catch (e) {
        if (!cancelled) {
          setResults([]);
          setMessage(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function track(id) {
    setBusyId(id);
    try {
      await onTrack(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>Find products</h1>
        <p className="muted">Search the INE store by part of a name, brand, category or SKU.</p>
      </div>

      <section className="searchbox">
        <input
          className="input input-big"
          type="search"
          autoFocus
          placeholder="Try “AR glasses”, “headphones” or “blender”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ideas">
          <span className="muted small">Try:</span>
          {IDEAS.map((idea) => (
            <button key={idea} className="chip chip-button" onClick={() => setQuery(idea)}>
              {idea}
            </button>
          ))}
        </div>
      </section>

      {loading && <p className="muted">Searching…</p>}
      {message && <p className="notice notice-bad">{message}</p>}
      {results && !loading && results.length === 0 && !message && <p className="muted">No products match “{query}”.</p>}

      {results && results.length > 0 && (
        <div className="grid grid-results">
          {results.map((p) => {
            const tracked = trackedIds.has(p.id);
            return (
              <article className="rcard" key={p.id}>
                <div>
                  <span className="chip chip-cat">{p.category}</span>
                  <h3 className="rcard-name">{p.name}</h3>
                  <div className="muted small">
                    {p.brand} · {p.sku}
                  </div>
                </div>
                {tracked ? (
                  <button className="btn btn-outline" onClick={() => onOpen(p.id)}>
                    Tracking · Open
                  </button>
                ) : (
                  <button className="btn" disabled={busyId === p.id} onClick={() => track(p.id)}>
                    {busyId === p.id ? "Adding…" : "Track"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
