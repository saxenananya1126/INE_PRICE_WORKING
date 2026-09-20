const STATUS = {
  ok: { text: "Backend connected", cls: "ok" },
  connecting: { text: "Connecting…", cls: "wait" },
  waking: { text: "Server waking up…", cls: "wait" },
  error: { text: "Backend unreachable", cls: "bad" }
};

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="9" fill="#0f766e" />
      <path d="M7 22 L13 15 L18 19 L27 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="27" cy="9" r="2.4" fill="#fbbf24" />
    </svg>
  );
}

export default function Header({ route, apiState, trackedCount, onRefreshAll, refreshing }) {
  const status = STATUS[apiState] || STATUS.connecting;
  const active = route.name === "find" ? "find" : "overview";

  return (
    <header className="header">
      <div className="header-inner">
        <a className="brand" href="#/">
          <Logo />
          <span>
            <span className="brand-name">INE Price Tracker</span>
            <span className="brand-sub">Store price &amp; stock watcher</span>
          </span>
        </a>

        <nav className="nav" aria-label="Main">
          <a href="#/" className={active === "overview" ? "on" : ""}>
            Overview{trackedCount ? <span className="nav-count">{trackedCount}</span> : null}
          </a>
          <a href="#/find" className={active === "find" ? "on" : ""}>
            Find products
          </a>
        </nav>

        <div className="header-right">
          <span className={`status status-${status.cls}`}>
            <span className="dot" /> {status.text}
          </span>
          <button className="btn" onClick={onRefreshAll} disabled={refreshing || !trackedCount}>
            {refreshing ? "Queuing…" : "Refresh all"}
          </button>
        </div>
      </div>
    </header>
  );
}
