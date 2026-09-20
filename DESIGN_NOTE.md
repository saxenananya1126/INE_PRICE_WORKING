# Design note

## 1. Lightweight fetch or headless browser?

I used both, each where it is needed.

- **Plain HTTP (no browser)** for the catalog (`/api/catalog`) and product details (`/api/product/:id`). They are JSON, so a browser would only add cost.
- **Headless Chromium (Playwright)** only for price and stock. The price is not in the page until "Reveal price" is used, which triggers `challenge`, then `session`, then `price` requests. The store only completes this after a human-like hover and press. The price markup is also deliberately awkward (see section 4). A plain fetch cannot get a correct price from it.

## 2. How the scraping is made reliable

**Per attempt**
- The cookie banner is waited for (it appears about 5 s after load), clicked, and checked to be gone.
- The mouse glides into the price block, onto the button, dwells about a second, then presses and releases. If `/api/challenge` does not fire, it clicks again on the same page (up to 3 times).
- It checks that the challenge request fired and that a price response arrived, and it fails with a specific reason if not (for example "the price API's first answer was HTTP 503").
- It reads the price from the element the store's own layout descriptor (`/api/layout`) names, using only text that is really visible, in the order it is drawn. It ignores hidden decoy prices and includes text drawn by CSS.
- It waits until "Updating..." has gone and the values are identical on two reads in a row.

**Per run**
- Up to 3 attempts, with 2 s and 4 s waits between them. Every attempt is recorded with its error and duration.
- All waits scale with `TIMEOUT_SCALE`, so the slow free Render instance uses longer waits than a laptop.

**Before anything is stored**
- The price must be a positive number, stock must be known, price must not exceed MRP, and it must not be implausibly low against MRP. The database also refuses a price of 0.
- The price is compared with the store's own `/price` response. A disagreement is flagged, not fatal, because the price can refresh in between.

**Honest history and log**
- `price_history` only receives rows for validated successes. A failure never overwrites the last good price.
- `scrape_logs` gets a row for every run: `success`, `retried` or `failed`, with the error message and the full attempt list. If the scrape worked but saving failed, the run is logged as `failed`.

**Scheduling on a free tier**
- cron-job.org calls `POST /api/cron/scrape` every 2 hours with a secret header. The endpoint answers `202` at once and works in the background, because cron-job.org gives up after about 30 s and Render can take about 50 s to wake.
- A second job pings `/api/health` every 10 minutes so the instance stays awake.
- Scrapes run one at a time (Chromium is heavy on a 512 MB instance, and it keeps load on a store that rate-limits with HTTP 429).

## 3. Trade-offs

- **Speed for correctness.** A browser scrape takes about 15 to 26 s on Render (about 19 s on a laptop). Five products take about 3 minutes, so 25 products fit in roughly 13 minutes, far inside the 2-hour gap.
- **One at a time.** Safer for memory and rate limits, but slower than running in parallel.
- **In-memory queue.** Simple, but a restart drops waiting jobs. The next scheduled run recovers them.
- **Discount label ignored.** The store's "% off" often disagrees with its own prices, so I show it but never use it to compute a price.
- **Soft cross-check.** A price that is missing from the API response is flagged, not rejected, to avoid false failures when it refreshes.
- **Freshness versus the fixed schedule.** The cron job is the 2-hour schedule. So the dashboard does not look stale, opening it while prices are over 30 minutes old also starts a refresh, with a cooldown of 10 minutes for everyone. Every scrape is labelled with its trigger (scheduled, manual, auto-refresh or first scrape), so extra scrapes are visible and the scheduled ones remain easy to check.
- **Service key in the backend only**, with row-level security on every table.
- **No screen yet** for editing per-product frequency. The column and the scheduler support it.

## 4. What my AI tool got wrong, and how I fixed it

I used Claude as a coding assistant. Its first attempts were wrong in these ways:

1. **Read the wrong price.** It took the first two `₹` amounts from the page text. The real price is split into pieces, so only the struck-through MRP matched, and the MRP was reported as the price. The page also holds hidden decoy prices. Fix: read the visible price element chosen by the store's layout descriptor.
2. **Then missed digits.** The reader returned `₹5` for `₹5,642`, because digits drawn by CSS or placed outside their element were dropped. The AI's "not visible" filter was too strict. Fix: include CSS-drawn text and text that overflows its box.
3. **Accepted an absurd price.** Validation only checked `price > 0`, so `₹5` passed. Fix: a plausibility check against MRP, and a database constraint.
4. **Hid blocked clicks.** It used `click({ force: true })`, which skips Playwright's "is this clickable" check, so a blocked click looked like success. Fix: no force, and an explicit check that the challenge request fired.
5. **Quick mouse jumps did nothing.** Five instant `mouse.move()` calls did not count as a hover. Fix: many small eased moves, a dwell, and a real press and release.
6. **Cookie banner check did not wait.** `page.$()` returns immediately, before the banner has rendered. Fix: wait for the banner, click, verify it is gone.
7. **Trusted the catalog pages.** Reading all 50 pages gave 1000 rows but only 648 different products (pages overlap). Fix: a second step that looks up every missing product id.
8. **Hit the rate limit.** The first catalog loader used 5 parallel requests and got HTTP 429. Fix: one request at a time, pauses, backoff, and respecting `Retry-After`.
9. **Coupled two timeouts.** Shortening the click window also shortened the wait for the (deliberately slow) price response. Fix: separate windows.
10. **Pointed me at a metric that does not exist.** It told me to read Render's memory chart, but the free plan has none. Fix: the app now reports its own container memory in `/api/health` and in each scrape log line.
11. **File-name casing.** Imports worked on Windows and would have failed on Render (Linux). Fix: `scripts/checkImports.js`.

## 5. Measured results

From the scrape log in Supabase (updated as more runs accumulate):

| Outcome | Runs | Average time |
|---|---|---|
| Success on the first attempt | 10 | 19.4 s |
| Retried, then succeeded | 3 | 53.3 s |
| Failed all attempts (logged, nothing stored) | 2 | 70.3 s |

Both failures happened in the first minutes after deploying to Render. The runs after that succeeded on the first attempt.
