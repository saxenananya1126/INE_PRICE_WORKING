import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useHashRoute } from "./hooks/useHashRoute";
import Header from "./components/Header";
import OverviewView from "./components/OverviewView";
import SearchView from "./components/SearchView";
import ProductView from "./components/ProductView";

const POLL_MS = 15000;

// When someone opens the dashboard and any price is older than this many minutes, a refresh is started
// automatically (logged as "auto"). The 2-hourly cron job stays the fixed schedule. 0 turns this off.
const AUTO_REFRESH_MIN = Number(import.meta.env.VITE_AUTO_REFRESH_MINUTES ?? 30);

export default function App() {
  const [route, go] = useHashRoute();
  const [tracked, setTracked] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [toast, setToast] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState(null); // { count, auto } while a refresh is running
  const autoTried = useRef(false);

  const notify = useCallback((text, kind = "ok") => setToast({ text, kind, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadTracked = useCallback(async () => {
    try {
      setTracked(await api.tracked());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadTracked();
    const timer = setInterval(loadTracked, POLL_MS);
    return () => clearInterval(timer);
  }, [loadTracked]);

  // the free backend sleeps when idle: say so instead of showing a blank page
  useEffect(() => {
    if (tracked !== null) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [tracked]);

  // the banner goes away once the queued scrapes should be done (about 45 s per product)
  useEffect(() => {
    if (!refreshInfo) return;
    const timer = setTimeout(() => setRefreshInfo(null), Math.max(1, refreshInfo.count) * 45000);
    return () => clearTimeout(timer);
  }, [refreshInfo]);

  // start a refresh by itself, once per visit, if the data on screen is old
  useEffect(() => {
    if (autoTried.current || !tracked || tracked.length === 0 || !(AUTO_REFRESH_MIN > 0)) return;
    autoTried.current = true;

    const limit = AUTO_REFRESH_MIN * 60000;
    const stale = tracked.some((p) => p.last_attempt_at && Date.now() - new Date(p.last_attempt_at).getTime() > limit);
    if (!stale) return;

    let last = 0;
    try {
      last = Number(sessionStorage.getItem("autoRefreshAt")) || 0;
    } catch {
      /* storage not available */
    }
    if (Date.now() - last < 10 * 60000) return;
    try {
      sessionStorage.setItem("autoRefreshAt", String(Date.now()));
    } catch {
      /* storage not available */
    }

    api
      .scrapeAll("auto")
      .then((r) => {
        if (r.queued) {
          setRefreshInfo({ count: r.queued, auto: true });
          loadTracked();
        }
      })
      .catch(() => {
        /* 429 just means somebody refreshed a few minutes ago */
      });
  }, [tracked, loadTracked]);

  const apiState = loadError ? "error" : tracked === null ? (slow ? "waking" : "connecting") : "ok";
  const trackedIds = useMemo(() => new Set((tracked || []).map((p) => p.product_id)), [tracked]);

  const track = useCallback(
    async (id) => {
      try {
        const r = await api.track(id);
        await loadTracked();
        notify(r.alreadyTracked ? "Already tracked." : "Now tracking. The first scrape is queued and takes about a minute.");
      } catch (e) {
        notify(e.message, "bad");
      }
    },
    [loadTracked, notify]
  );

  const scrapeOne = useCallback(
    async (id) => {
      setBusyIds((s) => new Set(s).add(id));
      try {
        await api.scrapeNow(id);
        notify("Scrape queued. The new price appears within a minute or two.");
        loadTracked();
      } catch (e) {
        if (e.status === 429) notify(`Scraped very recently. Try again in ${e.body?.retryAfterSeconds ?? "a few"} seconds.`, "warn");
        else if (e.status === 409) notify("This product is already queued or being scraped.", "warn");
        else notify(e.message, "bad");
      } finally {
        setBusyIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [loadTracked, notify]
  );

  const remove = useCallback(
    async (p) => {
      if (!window.confirm(`Stop tracking “${p.name}”? Its history and log will be deleted.`)) return;
      try {
        await api.untrack(p.product_id);
        notify("Stopped tracking.");
        if (route.name === "product" && route.id === p.product_id) go("/");
        await loadTracked();
      } catch (e) {
        notify(e.message, "bad");
      }
    },
    [go, loadTracked, notify, route]
  );

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.scrapeAll("manual");
      if (r.queued) setRefreshInfo({ count: r.queued, auto: false });
      notify(r.queued ? `Queued ${r.queued} scrape${r.queued > 1 ? "s" : ""}. Prices update over the next few minutes.` : "Everything is already queued.");
      loadTracked();
    } catch (e) {
      if (e.status === 429) notify(`Everything was refreshed recently. Try again in about ${Math.max(1, Math.ceil((e.body?.retryAfterSeconds ?? 60) / 60))} min.`, "warn");
      else notify(e.message, "bad");
    } finally {
      setRefreshing(false);
    }
  }, [loadTracked, notify]);

  const open = useCallback((id) => go(`/product/${id}`), [go]);

  return (
    <>
      <Header route={route} apiState={apiState} trackedCount={tracked ? tracked.length : 0} onRefreshAll={refreshAll} refreshing={refreshing} />

      <main className="main">
        {apiState === "waking" && (
          <p className="notice notice-info">The server is on a free plan and sleeps when idle. It is waking up now, which can take up to a minute.</p>
        )}
        {apiState === "error" && <p className="notice notice-bad">Could not reach the server. Retrying automatically…</p>}
        {refreshInfo && (
          <p className="notice notice-info">
            {refreshInfo.auto ? `Some prices were more than ${AUTO_REFRESH_MIN} minutes old, so a refresh has started. ` : "Refresh in progress. "}
            {refreshInfo.count} product{refreshInfo.count > 1 ? "s are" : " is"} scraped one after another (about 30 seconds each), and each card updates as its scrape finishes.
          </p>
        )}

        {route.name === "overview" && (
          <OverviewView tracked={tracked} busyIds={busyIds} onOpen={open} onScrape={scrapeOne} onRemove={remove} />
        )}
        {route.name === "find" && <SearchView trackedIds={trackedIds} onTrack={track} onOpen={open} />}
        {route.name === "product" && (
          <ProductView
            id={route.id}
            product={tracked ? tracked.find((p) => p.product_id === route.id) : null}
            trackedLoaded={tracked !== null}
            busy={busyIds.has(route.id)}
            onScrape={scrapeOne}
            onRemove={remove}
          />
        )}
      </main>

      <footer className="footer">Prices are read from the INE mock store by a scheduled scraper (every 2 hours). Every attempt, including failures, is logged.</footer>

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}