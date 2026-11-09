// App developer scenarios for loading piece artwork. Each scenario mounts a
// board in jsdom over a stubbed network and checks which files it asks for.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});

const BOARD_SIZE = 800;
const SQUARE_SIZE = BOARD_SIZE / 8;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperties(dom.window.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => BOARD_SIZE },
  offsetHeight: { configurable: true, get: () => BOARD_SIZE },
  getBoundingClientRect: {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: BOARD_SIZE,
        bottom: BOARD_SIZE,
        width: BOARD_SIZE,
        height: BOARD_SIZE,
        toJSON: () => ({}),
      };
    },
  },
});

dom.window.HTMLElement.prototype.animate = function animate() {
  return { finished: Promise.resolve(), onfinish: null, oncancel: null, cancel() {} };
};
dom.window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent() { return false; },
});

const define = (name, value) => {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
};
define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('HTMLElement', dom.window.HTMLElement);
define('Element', dom.window.Element);
define('Node', dom.window.Node);
define('DOMRect', dom.window.DOMRect);
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
define('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
define('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
define('ResizeObserver', ResizeObserverStub);
define('MutationObserver', dom.window.MutationObserver);
define('Image', dom.window.Image);
define('matchMedia', dom.window.matchMedia);

const requestedUrls = [];
define('fetch', async (url) => {
  requestedUrls.push(url);
  return {
    ok: true,
    status: 200,
    blob: async () => ({ fetchedFrom: url }),
    text: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  };
});
// An <img> then shows the URL that its blob came from, so a scenario can read it.
URL.createObjectURL = (blob) => blob.fetchedFrom;

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { ChessiroCanvas, preloadPieceSet, resolvePieceImageSrc } = await import('../dist/index.js');

let failures = 0;
let passes = 0;
function expectThat(condition, label) {
  if (condition) {
    passes += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(15);
const WAIT_LIMIT_MS = 5000;

async function waitUntil(boardReached) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!boardReached() && Date.now() < deadline) await sleep(5);
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const ALL_PIECE_CODES = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];

const pieceSetAt = (path, fields = {}) => ({ id: path, name: path, path, ...fields });
const urlsFor = (urlOfCode) => ALL_PIECE_CODES.map(urlOfCode);
const sameUrls = (actual, expected) => (
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
);

function centerOf(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return [(file + 0.5) * SQUARE_SIZE, (8 - rank + 0.5) * SQUARE_SIZE];
}

function mouseEvent(type, [clientX, clientY]) {
  return new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
}

// `makePieceSet` runs on every parent render, as an inline prop does in an app.
async function openBoard({ makePieceSet }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const boardRef = React.createRef();
  const dests = new Map([['e2', ['e4']]]);
  let rerenderParent;

  function ParentApp() {
    const [, setTick] = React.useState(0);
    rerenderParent = () => setTick((tick) => tick + 1);
    return React.createElement(ChessiroCanvas, {
      ref: boardRef,
      position: START,
      turnColor: 'w',
      movableColor: 'w',
      dests,
      pieceSet: makePieceSet?.(),
      onMove: () => true,
    });
  }

  root.render(React.createElement(ParentApp));
  await waitUntil(() => container.querySelector('img') !== null);
  await settle();

  const cell = (square) => container.querySelector(`[data-square="${square}"]`);
  const sourcesOf = (images) => images.map((image) => image.getAttribute('src'));

  const board = {
    async press(square) {
      cell(square).dispatchEvent(mouseEvent('mousedown', centerOf(square)));
      await settle();
    },
    async moveTo(square) {
      document.dispatchEvent(mouseEvent('mousemove', centerOf(square)));
      await settle();
    },
    async release(square) {
      document.dispatchEvent(mouseEvent('mouseup', centerOf(square)));
      await settle();
    },
    async rerender() {
      rerenderParent();
      await settle();
    },
    boardImageUrls: () => sourcesOf([...container.querySelectorAll('img')]),
    dragGhostImageUrls: () => sourcesOf(
      [...document.querySelectorAll('img')].filter((image) => !container.contains(image)),
    ),
    snapshotSvg: () => boardRef.current.toSVG(),
    // The returned promise waits for an image decode that jsdom never runs.
    startImageExport() {
      boardRef.current.toImage();
      return settle();
    },
    async close() {
      root.unmount();
      container.remove();
      await settle();
    },
  };
  return board;
}

function forgetRequests() {
  requestedUrls.length = 0;
}

console.log('\n-- a dragged piece shows the artwork of the app --');
{
  const board = await openBoard({ makePieceSet: () => pieceSetAt('/ghost', { extension: 'png' }) });
  await board.press('e2');
  await board.moveTo('e4');
  expectThat(sameUrls(board.dragGhostImageUrls(), ['/ghost/wp.png']),
    'A player drags a pawn from a PNG piece set: the piece under the cursor is the PNG file');
  await board.release('e4');
  await board.close();
}

console.log('\n-- a board asks only for files that exist --');
{
  forgetRequests();
  const board = await openBoard({ makePieceSet: () => pieceSetAt('/webp', { extension: 'webp' }) });
  expectThat(requestedUrls.length === 12 && sameUrls(requestedUrls, urlsFor((code) => `/webp/${code}.webp`)),
    'An app mounts a board with a WebP piece set: the board requests the 12 WebP files once each');
  expectThat(!requestedUrls.some((url) => url.includes('.svg')),
    'An app mounts a board with a WebP piece set: the board requests no SVG file');
  await board.close();
}
{
  forgetRequests();
  const hashedUrl = (code) => `https://cdn.example/art/${code}.a1b2c3.png?v=2`;
  const board = await openBoard({
    makePieceSet: () => pieceSetAt('', { resolveSrc: hashedUrl }),
  });
  expectThat(requestedUrls.length === 12 && sameUrls(requestedUrls, urlsFor(hashedUrl)),
    'An app serves hashed and versioned URLs: the board requests exactly those URLs');
  expectThat(board.boardImageUrls().every((url) => url.startsWith('https://cdn.example/art/')),
    'An app serves hashed and versioned URLs: every piece on the board shows one of those URLs');
  await board.close();
}
{
  forgetRequests();
  const board = await openBoard({
    makePieceSet: () => pieceSetAt('/inline', { resolveSrc: (code) => `/inline-cdn/${code}.png` }),
  });
  forgetRequests();
  await board.rerender();
  await board.rerender();
  expectThat(requestedUrls.length === 0,
    'A parent re-renders with a new inline piece set and a new inline URL function: the board requests nothing more');
  await board.close();
}
{
  forgetRequests();
  const board = await openBoard({});
  expectThat(requestedUrls.length === 0,
    'An app uses the bundled pieces: the board requests no file');
  await board.close();
}

console.log('\n-- existing apps keep working --');
{
  forgetRequests();
  preloadPieceSet('/string-path');
  await settle();
  expectThat(requestedUrls.length === 12 && sameUrls(requestedUrls, urlsFor((code) => `/string-path/${code}.svg`)),
    'An existing app preloads a set by its folder path: the 12 SVG files are requested');
  expectThat(resolvePieceImageSrc('wQ', '/p') === '/p/wq.svg',
    'An existing app asks for the queen image by its folder path: it receives the SVG URL');
  expectThat(resolvePieceImageSrc('wQ').startsWith('data:image/'),
    'An existing app asks for the queen image with no folder: it receives the bundled artwork');
}
{
  forgetRequests();
  preloadPieceSet(pieceSetAt('/preload-avif', { extension: 'avif' }));
  await settle();
  expectThat(sameUrls(requestedUrls, urlsFor((code) => `/preload-avif/${code}.avif`)),
    'An app preloads a whole AVIF piece set before the board mounts: the 12 AVIF files are requested');
}

console.log('\n-- an app names its files --');
expectThat(resolvePieceImageSrc('wQ', pieceSetAt('/p', { extension: '.png' })) === '/p/wq.png',
  'An app writes the extension with a leading dot: the URL has one dot');
expectThat(resolvePieceImageSrc('wQ', pieceSetAt('/p', { extension: 'png' })) === '/p/wq.png',
  'An app writes the extension with no dot: the URL has one dot');
expectThat(resolvePieceImageSrc('wQ', pieceSetAt('/p', { extension: '' })) === '/p/wq.svg',
  'An app leaves the extension empty: the URL is the SVG file');
expectThat(resolvePieceImageSrc('wQ', pieceSetAt('/p', {
  extension: 'gif',
  resolveSrc: (code) => `/cdn/${code}.webp`,
})) === '/cdn/wq.webp',
'An app gives a URL function together with a folder and an extension: the function decides the URL');

console.log('\n-- board exports use the same files --');
{
  const board = await openBoard({ makePieceSet: () => pieceSetAt('/export-svg-output', { extension: 'png' }) });
  const svg = board.snapshotSvg();
  expectThat(svg.includes('/export-svg-output/wq.png') && !svg.includes('/export-svg-output/wq.svg'),
    'An app exports a PNG piece set board as SVG: the document links the PNG files');
  await board.close();
}
{
  const board = await openBoard({ makePieceSet: () => pieceSetAt('/shared-folder', { extension: 'png' }) });
  forgetRequests();
  await board.startImageExport();
  expectThat(sameUrls(requestedUrls, urlsFor((code) => `/shared-folder/${code}.png`)),
    'An app exports an image of a PNG piece set board: the export requests the PNG files');
  await board.close();
}
{
  const board = await openBoard({ makePieceSet: () => pieceSetAt('/shared-folder', { extension: 'webp' }) });
  forgetRequests();
  await board.startImageExport();
  expectThat(sameUrls(requestedUrls, urlsFor((code) => `/shared-folder/${code}.webp`)),
    'An app exports a second piece set from the same folder with another extension: the export requests its own files');
  await board.close();
}
{
  const exportUrl = (code) => `/export-cdn/${code}.png?v=7`;
  const board = await openBoard({
    makePieceSet: () => pieceSetAt('', { resolveSrc: (code) => exportUrl(code) }),
  });
  forgetRequests();
  await board.startImageExport();
  expectThat(sameUrls(requestedUrls, urlsFor(exportUrl)),
    'An app exports an image of a board with a URL function: the export requests the URLs of the function');
  forgetRequests();
  await board.rerender();
  await board.startImageExport();
  expectThat(requestedUrls.length === 0,
    'An app exports again after a re-render with a new inline URL function: the export reuses the first download');
  await board.close();
}

console.log('\n-- one place owns piece URLs --');
{
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
  const sourceFiles = (folder) => readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
  const filesMatching = (pattern) => sourceFiles(sourceRoot)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(sourceRoot.length + 1));

  expectThat(filesMatching(/\.svg[`'"]|\}\.svg/).length === 0,
    'A maintainer searches the source for a fixed SVG file name: no module builds one');
  expectThat(sameUrls(filesMatching(/resolveSrc/), ['defaultPieces.ts', 'types.ts']),
    'A maintainer looks for code that calls the URL function of an app: only the piece resolver does');
}

console.log(`\n${passes} scenarios passed, ${failures} failed`);
dom.window.close();
if (failures > 0) process.exitCode = 1;
