# INE Price Tracker

Pick a product from INE's mock store, track it, and watch its price and stock over time.
A scraper reads the store every 2 hours, and every scrape attempt (including failures) is logged.

| | |
|---|---|
| **Live dashboard** | https://ine-price-working.vercel.app/|
| **Design note** | [DESIGN_NOTE.md](DESIGN_NOTE.md) |

> The API runs on Render's free plan and sleeps when idle. The first request after a quiet period can take up to a minute; the dashboard shows a "waking up" message.

## What it does

1. **Search** the store by partial or full product name (the catalog is copied into Supabase, so search is a database query).
2. **Track** a product. It is scraped straight away, then on a schedule.
3. **Price and stock history** as a chart or table, plus seller, delivery, MRP and next scheduled scrape.
4. **Scrape log** for every run: time, outcome (`success`, `retried`, `failed`), attempts, duration, error text, and every attempt inside the run.
5. An overview across all tracked products (summary strip, trend lines, price change since the last scrape), a per-product "Scrape now" and a "Refresh all" button.

## Architecture

```
cron-job.org ── every 2 h: POST /api/cron/scrape (secret header) ──┐
             └─ every 10 min: GET /api/health (keeps Render awake) ─┤
                                                                    ▼
Vercel (React)  ──►  Render (Express API + Playwright/Chromium scraper)  ──►  Supabase (Postgres)
```

- **Frontend:** React + Vite + Recharts, on Vercel (`frontend/`).
- **Backend:** Node.js + Express, in a Docker container on Render (`backend/`).
- **Database:** Supabase Postgres (`backend/supabase/schema.sql`).
- **Scraping:** plain HTTP for the catalog and product details; headless Chromium (Playwright) for price and stock, because the price only appears after a human-like "Reveal price" interaction and is drawn with obfuscated markup.
- **Scheduling:** an external cron service (cron-job.org), because the free Render instance sleeps.

## Scraping schedule

| Job (cron-job.org) | Request | When |
|---|---|---|
| Scrape every 2 hours | `POST https://ine-price.onrender.com/api/cron/scrape` with header `x-cron-secret` | minute 0 of every second hour (Asia/Kolkata) |
| Keep awake | `GET https://ine-price.onrender.com/api/health` | every 10 minutes |

The scrape endpoint answers `202` immediately and the work runs in a one-at-a-time queue in the background. Each call queues every active tracked product, so the cron job is the schedule and every product is refreshed once per run. A newly tracked product is scraped immediately, and the dashboard has a per-product "Scrape now" button. `POST /api/cron/scrape?due=1` queues only the products whose own interval has passed.

Scrapes are labelled in the log by what started them: **Scheduled** (the cron job, every 2 hours), **Manual** (a button), **Auto-refresh** (the dashboard was opened while prices were more than 30 minutes old; at most one refresh per 10 minutes for all visitors together) and **First scrape** (right after a product is tracked). So the fixed 2-hour schedule stays visible in the log, and any extra scrape is clearly marked.

## Environment variables

**Backend** (`backend/.env`, or Render's Environment tab)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key. Backend only, never in the frontend |
| `CRON_SECRET` | Shared secret the cron job sends in `x-cron-secret` |
| `STORE_BASE_URL` | `https://demo.inelabteamdev.com` |
| `FRONTEND_ORIGIN` | Allowed dashboard origin(s), comma separated (empty = allow all) |
| `HEADLESS` | `1` = no browser window (required on Render). Unset = visible browser |
| `TIMEOUT_SCALE` | Multiplies scraper waits. `1` locally, `2` on Render |
| `MAX_TRACKED` | Limit on tracked products (default 25) |
| `PORT` | Set by Render |

Optional while developing: `DEBUG_SCRAPER=1` (verbose logs), `SIMULATE=slow|fail|both` (see below), `SCREENSHOT_DIR`.

**Frontend** (`frontend/.env`, optional): `VITE_API_URL` (defaults to the live API) and `VITE_AUTO_REFRESH_MINUTES` (default 30; `0` turns the automatic refresh on open off).

## Run it locally

```powershell
# 1. Supabase: create a project, open SQL Editor, run backend/supabase/schema.sql

# 2. Backend
cd backend
copy .env.example .env        # then fill in the values
npm install
npx playwright install chromium
npm run sync-catalog          # copies the store's ~1000 products into Supabase (a few minutes)
npm start                     # http://localhost:4000

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
# to use a local backend: put VITE_API_URL=http://localhost:4000 in frontend/.env
```

## Headed (observable) run

With `HEADLESS` unset, Chromium opens a visible window:

```powershell
cd backend
node scripts/testScraper.js 660
```

To watch slow and failing responses on demand:

```powershell
$env:SIMULATE="fail"; node scripts/testScraper.js 660   # price API returns HTTP 503 on attempt 1, attempt 2 works
$env:SIMULATE="slow"; node scripts/testScraper.js 660   # price API answers 6 s late
Remove-Item Env:SIMULATE
```

## Useful scripts (`backend/scripts`)

| Script | What it does |
|---|---|
| `testScraper.js <id>` | Scrape one product with retries and print the result |
| `testManyProducts.js --ids 660,881,989 --parallel 3` | Scrape several products and build `scrape-report.html` (screenshot next to scraped values) |
| `inspectPrice.js <id>` | Show how a product's price element is built |
| `syncCatalog.js` | Copy the store catalog into Supabase |
| `checkImports.js` | Check file-name casing in imports (Windows vs Linux) |

## API

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Status, queue length, memory |
| `GET /api/search?q=` | Search the catalog |
| `POST /api/track` `{productId}` | Track a product and queue its first scrape |
| `GET /api/tracked` | Tracked products with latest price and last outcome |
| `DELETE /api/track/:id` | Stop tracking |
| `GET /api/products/:id/history` | Price and stock history |
| `GET /api/products/:id/logs` | Scrape log |
| `POST /api/products/:id/scrape` | Scrape now (60 s cooldown) |
| `POST /api/scrape-all` | "Refresh all" button and the automatic refresh: queue every tracked product (10 min cooldown) |
| `GET/POST /api/cron/scrape` | Scheduled scrape (needs `x-cron-secret`) |
| `GET/POST /api/cron/sync-catalog` | Refresh the catalog (needs `x-cron-secret`) |

## Project structure

```
backend/
  supabase/schema.sql        tables, view, row-level security
  src/server.js              Express routes
  src/store.js               all database access
  src/services/runner.js     scrape queue, honest logging
  src/services/catalog.js    catalog sync (pages, then gap fill by id)
  src/services/memory.js     container memory reporting
  src/services/scraper/      browser, cookies, human-like click, price reader, retry, simulation
  scripts/                   test and diagnostic scripts
  Dockerfile
frontend/
  src/                       React dashboard
```

## Known limitations

- The scrape queue is in memory: a restart drops jobs that were waiting. The next scheduled run picks them up.
- Render's free plan sleeps and has little CPU, so scrapes there are slower than on a laptop (waits are doubled with `TIMEOUT_SCALE=2`).
- The store changes prices and MRP on every read, and its discount label often disagrees with its own prices, so the label is shown but never trusted.
- Per-product scrape frequency is stored (`interval_minutes`) and honored by the scheduler, but there is no screen to edit it yet.
