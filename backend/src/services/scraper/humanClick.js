// backend/src/services/scraper/humanClick.js
//
// Hover the price block, hover the Reveal button, dwell, then press like a person.
// Coordinates are measured only after the layout has stopped moving, and the button is
// re-measured right before the final move, because the page can shift (cookie banner
// collapsing, late content) between measuring and moving.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

// Tunable. If the store enforces a minimum number of movements, a minimum gap between
// them and a minimum hover time, these are set comfortably above such limits:
const GLIDE_STEPS = 10;          // mouse moves per glide (2 glides => 20+ moves in total)
const MOVE_GAP_MS = [50, 70];    // pause between two moves
const DWELL_MS = [700, 1000];    // hover time on the button before pressing

// Many small mouse.move() calls with short pauses, eased, ending exactly on `to`.
async function glide(page, from, to, { steps = GLIDE_STEPS, wobble = 2 } = {}) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
    const x = from.x + (to.x - from.x) * e + rand(-wobble, wobble) * (1 - t);
    const y = from.y + (to.y - from.y) * e + rand(-wobble, wobble) * (1 - t);
    await page.mouse.move(x, y);
    await sleep(rand(...MOVE_GAP_MS));
  }
}

// Resolve once two consecutive readings of the element's box are identical (layout settled).
async function waitForStableBox(locator, { timeout = 3_000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  let prev = await locator.boundingBox();
  while (Date.now() < deadline) {
    await sleep(interval);
    const cur = await locator.boundingBox();
    if (
      prev && cur &&
      Math.abs(prev.x - cur.x) < 1 && Math.abs(prev.y - cur.y) < 1 &&
      Math.abs(prev.width - cur.width) < 1 && Math.abs(prev.height - cur.height) < 1
    ) {
      return cur;
    }
    prev = cur;
  }
  return prev; // best effort
}

/**
 * priceBlock / button are Playwright locators.
 */
async function humanRevealClick(page, priceBlock, button, log = console.log) {
  await button.scrollIntoViewIfNeeded({ timeout: 5_000 });
  await waitForStableBox(button); // let banner collapse / late layout finish

  const pb = await priceBlock.boundingBox();
  if (!pb) throw new Error("price block has no bounding box");

  const start = { x: Math.max(5, pb.x - 80), y: Math.max(5, pb.y - 60) };
  const inside = { x: pb.x + pb.width * rand(0.15, 0.35), y: pb.y + pb.height * rand(0.3, 0.7) };

  await page.mouse.move(start.x, start.y);
  log("[human] entering price block");
  await glide(page, start, inside);
  await sleep(rand(300, 600));

  // re-measure: the page may have shifted while we were hovering the block
  const bb = await waitForStableBox(button, { timeout: 1_500 });
  if (!bb) throw new Error("Reveal button has no bounding box");
  const onButton = { x: bb.x + bb.width * rand(0.35, 0.65), y: bb.y + bb.height * rand(0.35, 0.65) };

  log("[human] moving onto Reveal button");
  await glide(page, inside, onButton);

  const dwell = Math.round(rand(...DWELL_MS));
  log(`[human] hovering button for ${dwell}ms`);
  await sleep(dwell);

  log("[human] pressing");
  await page.mouse.down();
  await sleep(rand(60, 140)); // a real press lasts a moment
  await page.mouse.up();
}

module.exports = { humanRevealClick };