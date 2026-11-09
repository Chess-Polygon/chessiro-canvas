// Player scenarios that need real press timing: mouse holds, touch holds and
// piece file requests. jsdom cannot show what a player sees during a hold, so
// these scenarios play demo/interaction-fixture.html in Chromium.
//
// Usage: npm run test:browser    (boots its own Vite server against demo/)

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FRAME_TEST_PORT ?? 5234);
const FIXTURE_URL = `http://localhost:${PORT}/interaction-fixture.html`;
const SETTLE_MS = 300;
const TOUCH_HOLD_MS = 700;
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: path.join(ROOT, 'demo'),
  stdio: 'ignore',
  detached: true,
});
const stopServer = () => { try { process.kill(-server.pid); } catch { /* already stopped */ } };
process.on('exit', stopServer);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => process.exit(code));
}

let failures = 0;
const assert = (condition, label) => {
  console.log(`${condition ? '  ok  ' : 'FAIL  '}${label}`);
  if (!condition) failures += 1;
};

const squareCenter = async (page, square) => {
  const box = await page.locator(`[data-square="${square}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const showsDot = (page, square) => page.evaluate((target) => {
  const cell = document.querySelector(`[data-square="${target}"]`);
  return getComputedStyle(cell).backgroundImage.includes('radial-gradient');
}, square);

const boardEvents = (page, name) => page.evaluate(
  (eventName) => window.__log.filter((event) => event.name === eventName),
  name,
);

const clickSquare = async (page, square) => {
  const { x, y } = await squareCenter(page, square);
  await page.mouse.click(x, y);
};

async function playOnFixture(browser, { query = '', hasTouch = false }, scenario) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch });
  try {
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request));
    await page.route('**/fixture-pieces/*', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    }));
    await page.goto(`${FIXTURE_URL}${query}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-square="g8"]');
    await scenario({ page, context, requests });
  } finally {
    await context.close();
  }
}

async function mouseHoldScenarios(browser) {
  await playOnFixture(browser, {}, async ({ page }) => {
    const { x, y } = await squareCenter(page, 'g8');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(SETTLE_MS);

    assert(await showsDot(page, 'f6'), 'A player holds the mouse on a knight: the knight shows its dots before any release');
    assert((await boardEvents(page, 'onSquareClick')).length === 0, 'A player holds the mouse on a knight: the board reports no square click yet');

    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);

    assert(await showsDot(page, 'f6'), 'A player releases the knight in place: the knight stays selected and keeps its dots');
    assert((await boardEvents(page, 'onSquareClick')).length === 1, 'A player releases the knight in place: the board reports exactly one square click');
  });
}

async function touchHoldScenario(browser) {
  await playOnFixture(browser, { hasTouch: true }, async ({ page, context }) => {
    const touch = await context.newCDPSession(page);
    const point = await squareCenter(page, 'g8');

    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(TOUCH_HOLD_MS);
    assert(await showsDot(page, 'f6'), 'A player holds a finger on a knight: the knight shows its dots during the hold');

    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(TOUCH_HOLD_MS);
    assert(await showsDot(page, 'f6'), 'A player lifts the finger after a long hold: the knight keeps its dots');
  });
}

async function premoveSwitchScenario(browser, allowDragging) {
  const mode = allowDragging ? 'with dragging on' : 'with dragging off';
  await playOnFixture(browser, { query: `?allowDragging=${allowDragging}` }, async ({ page }) => {
    await clickSquare(page, 'g8');
    await page.waitForTimeout(SETTLE_MS);
    await clickSquare(page, 'f6');
    await page.waitForTimeout(SETTLE_MS);
    assert((await boardEvents(page, 'set')).length === 1, `A player queues a premove ${mode}: the board reports the premove`);

    await page.evaluate(() => { window.__log.length = 0; });
    await clickSquare(page, 'b8');
    await page.waitForTimeout(SETTLE_MS);

    assert((await boardEvents(page, 'unset')).length === 1, `A player clicks another knight while a premove is queued ${mode}: the premove is cancelled once`);
    assert(await showsDot(page, 'c6'), `A player clicks another knight while a premove is queued ${mode}: the new knight shows its dots at once`);
  });
}

async function rasterRequestScenario(browser) {
  await playOnFixture(browser, {}, async ({ requests }) => {
    const pieceFetches = requests.filter((request) => (
      request.resourceType() === 'fetch' && new URL(request.url()).pathname.startsWith('/fixture-pieces/')
    ));
    const uniquePngUrls = new Set(pieceFetches.map((request) => request.url()).filter((url) => url.endsWith('.png')));
    const svgRequests = requests.filter((request) => new URL(request.url()).pathname.endsWith('.svg'));

    assert(pieceFetches.length === 12, `A player opens a board with a PNG set: the board preloads 12 piece files (got ${pieceFetches.length})`);
    assert(uniquePngUrls.size === 12, `A player opens a board with a PNG set: each piece has its own PNG file (got ${uniquePngUrls.size})`);
    assert(svgRequests.length === 0, `A player opens a board with a PNG set: the board requests no SVG file (got ${svgRequests.length})`);
  });
}

try {
  let serverIsUp = false;
  for (let attempt = 0; attempt < 60 && !serverIsUp; attempt += 1) {
    try { serverIsUp = (await fetch(FIXTURE_URL)).ok; } catch { /* not yet */ }
    if (!serverIsUp) await delay(500);
  }
  if (!serverIsUp) throw new Error(`dev server did not start on ${FIXTURE_URL}`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    await mouseHoldScenarios(browser);
    await touchHoldScenario(browser);
    await premoveSwitchScenario(browser, true);
    await premoveSwitchScenario(browser, false);
    await rasterRequestScenario(browser);
  } finally {
    await browser.close();
  }
} finally {
  stopServer();
}

if (failures > 0) {
  console.error(`\n${failures} browser interaction scenario(s) failed`);
  process.exit(1);
}
console.log('\nbrowser interaction scenarios passed');
