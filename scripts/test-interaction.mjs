// Player scenarios for selecting pieces and queuing premoves. Each scenario
// mounts a controlled board in jsdom and plays it through real DOM events.
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
define('fetch', async () => ({ ok: false, status: 404, blob: async () => null, text: async () => '' }));

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { ChessiroCanvas } = await import('../dist/index.js');

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
const FLAG_AFTER_ARROW_MS = 150;
const COMPATIBILITY_MOUSE_WINDOW_MS = 500;

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const AFTER_WHITE_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';

const SELECTED_OUTLINE = 'rgb(1, 1, 1)';
const LEGAL_DOT = 'rgb(2, 2, 2)';
const LEGAL_RING = 'rgb(3, 3, 3)';
const PREMOVE_DOT = 'rgb(4, 4, 4)';
const PREMOVE_RING = 'rgb(5, 5, 5)';
const QUEUED_PREMOVE = 'rgb(6, 6, 6)';
const READABLE_VISUALS = {
  selectedStyle: 'border',
  selectedOutline: SELECTED_OUTLINE,
  legalDot: LEGAL_DOT,
  legalCaptureRing: LEGAL_RING,
  premoveDot: PREMOVE_DOT,
  premoveCaptureRing: PREMOVE_RING,
  premoveCurrent: QUEUED_PREMOVE,
};

const WHITE_MOVES = { e2: ['e3', 'e4'], g1: ['f3', 'h3'], b1: ['a3', 'c3'] };
const BLACK_MOVES = { b8: ['a6', 'c6'], g8: ['f6', 'h6'] };

function centerOf(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return [(file + 0.5) * SQUARE_SIZE, (8 - rank + 0.5) * SQUARE_SIZE];
}

function destsMap(moves) {
  return moves ? new Map(Object.entries(moves)) : undefined;
}

function touchEvent(type, [clientX, clientY]) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  const point = { clientX, clientY };
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [point] },
    changedTouches: { value: [point] },
  });
  return event;
}

function mouseEvent(type, [clientX, clientY], button = 0) {
  return new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button });
}

// A parent app that keeps the premove in its own state and hands the board a
// new inline `premovable` object on every render, as real integrations do.
async function openBoard(setup) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const played = { unset: 0, sets: [], moves: [], clicks: [], arrowChanges: 0, events: [] };
  const parent = {};

  function ParentApp() {
    const [settings, setSettings] = React.useState(setup);
    const [queuedPremove, setQueuedPremove] = React.useState(null);
    const [arrows, setArrows] = React.useState(setup.arrows ?? []);
    const [, setTick] = React.useState(0);
    const stableDests = React.useMemo(() => destsMap(settings.moves), [settings.moves]);
    parent.updateSettings = (patch) => setSettings((current) => ({ ...current, ...patch }));
    parent.setQueuedPremove = setQueuedPremove;
    parent.rerender = () => setTick((tick) => tick + 1);

    return React.createElement(ChessiroCanvas, {
      position: settings.position ?? START,
      turnColor: settings.turnColor,
      movableColor: settings.movableColor,
      allowDragging: settings.allowDragging ?? true,
      dests: settings.newDestsEveryRender ? destsMap(settings.moves) : stableDests,
      squareVisuals: READABLE_VISUALS,
      arrows,
      onArrowsChange: (next) => {
        played.arrowChanges += 1;
        setArrows(next);
      },
      onSquareClick: (square) => played.clicks.push(square),
      onMove: (from, to) => {
        played.moves.push(`${from}${to}`);
        return true;
      },
      premovable: {
        enabled: settings.premovesEnabled ?? true,
        current: queuedPremove,
        events: {
          set: (from, to) => {
            played.sets.push(`${from}${to}`);
            played.events.push('set');
            setQueuedPremove([from, to]);
          },
          unset: () => {
            played.unset += 1;
            played.events.push('unset');
            setQueuedPremove(null);
          },
        },
      },
    });
  }

  root.render(React.createElement(ParentApp));
  await sleep(40);

  const cell = (square) => container.querySelector(`[data-square="${square}"]`);
  const cellStyle = (square) => cell(square).getAttribute('style') ?? '';

  const board = {
    played,
    parent,
    async press(square) {
      cell(square).dispatchEvent(mouseEvent('mousedown', centerOf(square)));
      await settle();
    },
    async moveTo(square, [offsetX, offsetY] = [0, 0]) {
      const [x, y] = centerOf(square);
      document.dispatchEvent(mouseEvent('mousemove', [x + offsetX, y + offsetY]));
      await settle();
    },
    async release(square, [offsetX, offsetY] = [0, 0]) {
      const [x, y] = centerOf(square);
      document.dispatchEvent(mouseEvent('mouseup', [x + offsetX, y + offsetY]));
      await settle();
    },
    async click(square) {
      await board.press(square);
      await board.release(square);
    },
    async dragAndDrop(from, to) {
      await board.press(from);
      await board.moveTo(to);
      await board.release(to);
    },
    async drawArrow(from, to) {
      cell(from).dispatchEvent(mouseEvent('mousedown', centerOf(from), 2));
      await settle();
      document.dispatchEvent(mouseEvent('mousemove', centerOf(to), 2));
      document.dispatchEvent(mouseEvent('mouseup', centerOf(to), 2));
      await settle();
    },
    async touchStart(square) {
      cell(square).dispatchEvent(touchEvent('touchstart', centerOf(square)));
      await settle();
    },
    async touchEnd(square) {
      document.dispatchEvent(touchEvent('touchend', centerOf(square)));
      await settle();
    },
    async update(patch) {
      parent.updateSettings(patch);
      await settle();
    },
    async rerenderParent() {
      parent.rerender();
      await settle();
    },
    async parentSetsPremove(premove) {
      parent.setQueuedPremove(premove);
      await settle();
    },
    isSelected: (square) => cellStyle(square).includes(SELECTED_OUTLINE),
    selectedSquares: () => [...container.querySelectorAll('[data-square]')]
      .filter((node) => (node.getAttribute('style') ?? '').includes(SELECTED_OUTLINE))
      .map((node) => node.getAttribute('data-square')),
    hasLegalDot: (square) => cellStyle(square).includes(LEGAL_DOT) || cellStyle(square).includes(LEGAL_RING),
    hasPremoveDot: (square) => cellStyle(square).includes(PREMOVE_DOT) || cellStyle(square).includes(PREMOVE_RING),
    showsQueuedPremove: (square) => cellStyle(square).includes(QUEUED_PREMOVE),
    promotionDialogIsOpen: () => container.querySelector('[role="dialog"]') !== null,
    arrowsOnBoard: () => container.querySelectorAll('svg g[opacity]').length,
    async close() {
      root.unmount();
      container.remove();
      await settle();
    },
  };
  return board;
}

const opponentToMove = (extra = {}) => ({
  turnColor: 'w',
  movableColor: 'b',
  moves: WHITE_MOVES,
  ...extra,
});
const playerToMove = (extra = {}) => ({
  turnColor: 'w',
  movableColor: 'w',
  moves: WHITE_MOVES,
  ...extra,
});

async function queueKnightPremove(board) {
  await board.click('b8');
  await board.click('c6');
}

const dragModes = [
  [true, 'with dragging on'],
  [false, 'with dragging off'],
];

console.log('\n-- switching pieces while a premove is queued --');
for (const [allowDragging, mode] of dragModes) {
  const board = await openBoard(opponentToMove({ allowDragging }));
  await queueKnightPremove(board);
  expectThat(board.played.sets.join() === 'b8c6' && board.showsQueuedPremove('c6'),
    `A player queues a knight premove ${mode}: the board shows the queued move`);
  await board.click('g8');
  expectThat(board.played.unset === 1,
    `A player clicks another knight while a premove is queued, ${mode}: the old premove is cancelled exactly once`);
  expectThat(board.isSelected('g8') && board.hasPremoveDot('f6') && board.hasPremoveDot('h6'),
    `A player clicks another knight while a premove is queued, ${mode}: the new knight shows its dots at once`);
  await sleep(40);
  expectThat(board.isSelected('g8') && board.hasPremoveDot('f6'),
    `A player clicks another knight while a premove is queued, ${mode}: the dots stay after the parent app re-renders`);
  await board.close();
}

for (const [allowDragging, mode] of dragModes) {
  const board = await openBoard(opponentToMove({ allowDragging, newDestsEveryRender: true }));
  await queueKnightPremove(board);
  await board.click('g8');
  await sleep(40);
  expectThat(board.played.unset === 1 && board.isSelected('g8') && board.hasPremoveDot('f6') && board.hasPremoveDot('h6'),
    `The app builds a new dests map on every render and it is the opponent's turn, ${mode}: one click on another knight selects it and keeps its dots`);
  await board.close();
}

console.log('\n-- premove dots across parent renders --');
{
  const board = await openBoard(opponentToMove());
  await board.click('b8');
  await board.rerenderParent();
  expectThat(board.isSelected('b8') && board.hasPremoveDot('a6') && board.hasPremoveDot('c6'),
    'A clock tick re-renders the app while a knight is selected for a premove: the dots stay');
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await board.click('g8');
  await board.parentSetsPremove(['b8', 'c6']);
  expectThat(board.showsQueuedPremove('c6'), 'The app queues a premove from outside while a knight is selected: the queued move appears');
  await board.parentSetsPremove(null);
  expectThat(!board.showsQueuedPremove('c6'), 'The app clears its premove from outside: the queued move disappears');
  expectThat(board.isSelected('g8') && board.hasPremoveDot('f6') && board.hasPremoveDot('h6'),
    'The app clears its premove from outside: the knight the player selected keeps its dots');
  await board.close();
}
for (const [allowDragging, mode] of dragModes) {
  const board = await openBoard(opponentToMove({ allowDragging }));
  await queueKnightPremove(board);
  await board.click('e4');
  expectThat(board.played.unset === 1 && !board.showsQueuedPremove('c6'),
    `A player clicks an empty square with a premove queued, ${mode}: the premove is cancelled exactly once`);
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await board.click('b8');
  await board.update({ premovesEnabled: false });
  expectThat(!board.hasPremoveDot('a6') && !board.hasPremoveDot('c6'),
    'The app turns premoves off while a knight is selected: its premove dots disappear');
  await board.close();
}
{
  const board = await openBoard(opponentToMove({ newDestsEveryRender: true }));
  await board.click('b8');
  await board.update({ position: AFTER_WHITE_E4 });
  expectThat(board.selectedSquares().length === 0 && !board.hasPremoveDot('a6'),
    'The position really changes while it is still the opponent\'s turn: the premove selection and its dots clear');
  await board.close();
}

console.log('\n-- the turn passes to the opponent with the same position --');
for (const [moves, description] of [
  [{ ...BLACK_MOVES }, 'the app still lists the knight move'],
  [undefined, 'the app lists no moves'],
]) {
  const board = await openBoard({ turnColor: 'b', movableColor: 'b', moves });
  await board.click('b8');
  expectThat(board.isSelected('b8'), `It is the player's turn and ${description}: a click selects the knight`);
  await board.update({ turnColor: 'w' });
  expectThat(board.selectedSquares().length === 0 && !board.hasLegalDot('a6'),
    `The turn flips to the opponent and ${description}: the selection and its legal dots reset`);
  await board.click('a6');
  expectThat(board.played.moves.length === 0,
    `The turn flips to the opponent and ${description}: a click on a former destination plays no move`);
  await board.close();
}
{
  const board = await openBoard({
    position: '8/8/8/8/8/8/7p/K1k5',
    turnColor: 'b',
    movableColor: 'b',
    moves: { h2: ['h1'] },
  });
  await board.click('h2');
  await board.click('h1');
  expectThat(board.promotionDialogIsOpen(), 'A player pushes a pawn to the last rank: the promotion dialog opens');
  await board.update({ turnColor: 'w' });
  expectThat(!board.promotionDialogIsOpen(), 'The turn flips to the opponent while the dialog is open: the dialog closes');
  await board.close();
}

console.log('\n-- a queued premove and a new press --');
{
  const board = await openBoard(opponentToMove());
  await board.click('g8');
  await board.parentSetsPremove(['b8', 'c6']);
  await board.click('g8');
  expectThat(board.played.unset === 1 && board.selectedSquares().length === 0,
    'A player clicks the selected knight with a premove queued: it deselects and the premove is cancelled exactly once');
  await board.close();
}

console.log(`\n${passes} scenarios passed, ${failures} failed`);
dom.window.close();
if (failures > 0) process.exitCode = 1;
