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

console.log('\n-- selecting a piece on press --');
{
  const board = await openBoard(playerToMove());
  await board.press('e2');
  expectThat(board.isSelected('e2') && board.hasLegalDot('e3') && board.hasLegalDot('e4'),
    'A player holds the mouse down on a pawn: its selection and legal dots show before the release');
  expectThat(board.played.clicks.length === 0, 'A player holds the mouse down on a pawn: the app hears no click yet');
  await board.release('e2');
  expectThat(board.isSelected('e2') && board.hasLegalDot('e4'), 'A player releases the pawn in place: it stays selected');
  expectThat(board.played.clicks.join() === 'e2', 'A player releases the pawn in place: the app hears one click');
  await board.click('e2');
  expectThat(board.selectedSquares().length === 0, 'A player clicks the selected pawn again: it deselects');
  expectThat(board.played.clicks.length === 1, 'A player clicks the selected pawn again: the app hears no new click');
  await board.close();
}
{
  const arrow = { startSquare: 'a3', endSquare: 'a5', color: '#15781B' };
  const board = await openBoard(playerToMove({ arrows: [arrow] }));
  await board.press('e2');
  await board.moveTo('e4');
  expectThat(board.isSelected('e2') && board.hasLegalDot('e3'), 'A player drags a pawn past the threshold: the selection stays during the drag');
  await board.release('e4');
  expectThat(board.played.moves.join() === 'e2e4', 'A player drops the pawn on a legal square: the move is played');
  expectThat(board.played.clicks.length === 0, 'A player drags a pawn: the app hears no click');
  expectThat(board.played.arrowChanges === 0 && board.arrowsOnBoard() === 1, 'A player drags a pawn: the arrows on the board stay');
  await board.close();
}
{
  const arrow = { startSquare: 'a3', endSquare: 'a5', color: '#15781B' };
  const board = await openBoard(playerToMove({ arrows: [arrow] }));
  await board.press('e2');
  expectThat(board.played.arrowChanges === 0 && board.arrowsOnBoard() === 1, 'A player holds the mouse on a pawn: the arrows on the board stay during the hold');
  await board.release('e2');
  expectThat(board.played.arrowChanges === 1 && board.arrowsOnBoard() === 0, 'A player clicks a pawn: the arrows on the board clear on release');
  await board.close();
}
{
  const board = await openBoard(playerToMove());
  await board.click('e2');
  await board.press('a1');
  expectThat(board.selectedSquares().length === 0 && !board.hasLegalDot('e4'), 'A player presses a blocked rook while a pawn is selected: the pawn loses its selection and dots at once');
  await board.release('a1');
  expectThat(board.selectedSquares().length === 0, 'A player releases the blocked rook: nothing is selected');
  await board.close();
}

console.log('\n-- presses that wait for the release --');
{
  const board = await openBoard(opponentToMove());
  await board.click('d8');
  expectThat(board.hasPremoveDot('d7'), 'A player selects the queen for a premove: a friendly pawn in its path is marked');
  await board.press('d7');
  expectThat(board.played.sets.length === 0, 'A player presses a friendly piece that the queen can reach: no premove queues on press');
  await board.release('d7');
  expectThat(board.played.sets.join() === 'd8d7', 'A player releases on that friendly piece: the premove queues');
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await board.click('d8');
  await board.press('d7');
  await board.moveTo('d5');
  expectThat(board.isSelected('d7') && !board.isSelected('d8') && board.hasPremoveDot('d6'),
    'A player drags a friendly piece that the queen can reach: the selection moves to the dragged piece');
  expectThat(board.played.sets.length === 0, 'A player drags a friendly piece that the queen can reach: no premove queues for the queen');
  await board.close();
}
{
  const board = await openBoard({
    position: 'r3k2r/8/8/8/8/8/8/R3K2R',
    turnColor: 'w',
    movableColor: 'w',
    moves: { e1: ['d1', 'f1', 'h1'], h1: ['h2', 'g1'] },
  });
  await board.click('e1');
  await board.press('h1');
  expectThat(board.played.moves.length === 0, 'A player castles by pressing the king onto the rook: nothing moves on press');
  await board.release('h1');
  expectThat(board.played.moves.join() === 'e1h1', 'A player castles by releasing on the rook: the castling move is played');
  await board.close();
}
{
  const board = await openBoard(playerToMove());
  await board.drawArrow('a3', 'a5');
  await board.press('e2');
  expectThat(board.selectedSquares().length === 0, 'A player presses a pawn right after drawing an arrow: the press does not select it');
  await sleep(FLAG_AFTER_ARROW_MS + 50);
  await board.release('e2');
  expectThat(board.isSelected('e2') && board.hasLegalDot('e4'), 'A player holds that press until the arrow guard ends and releases: the pawn is selected');
  await board.close();
}
{
  const board = await openBoard(playerToMove());
  await board.drawArrow('a3', 'a5');
  await board.dragAndDrop('e2', 'e4');
  expectThat(board.played.moves.join() === 'e2e4', 'A player drags a pawn right after drawing an arrow: the move is played');
  await board.close();
}

console.log('\n-- a queued premove and a new press --');
{
  const board = await openBoard(opponentToMove());
  await queueKnightPremove(board);
  await board.press('g8');
  expectThat(board.played.unset === 1 && !board.showsQueuedPremove('c6'),
    'A player presses another knight with a premove queued: the premove is cancelled once, at the press');
  expectThat(board.isSelected('g8') && board.hasPremoveDot('f6'), 'A player presses another knight with a premove queued: the new knight shows its dots during the hold');
  await board.update({
    position: AFTER_WHITE_E4,
    turnColor: 'b',
    moves: { ...BLACK_MOVES },
  });
  expectThat(board.played.moves.length === 0, 'The opponent moves while the player holds another knight: the replaced premove does not play');
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await queueKnightPremove(board);
  await board.dragAndDrop('g8', 'f6');
  expectThat(board.played.events.join() === 'set,unset,set' && board.played.sets.at(-1) === 'g8f6',
    'A player drags another knight to a new premove square: the old premove is cancelled, then the new one queues');
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await queueKnightPremove(board);
  await board.dragAndDrop('g8', 'a4');
  expectThat(board.played.unset === 1 && board.played.sets.length === 1 && !board.showsQueuedPremove('c6'),
    'A player drags another knight to an unreachable square: no premove stays queued');
  await board.close();
}
{
  const board = await openBoard(opponentToMove());
  await board.click('g8');
  await board.parentSetsPremove(['b8', 'c6']);
  await board.click('g8');
  expectThat(board.played.unset === 1 && board.selectedSquares().length === 0,
    'A player clicks the selected knight with a premove queued: it deselects and the premove is cancelled exactly once');
  await board.close();
}

console.log('\n-- touch and small drags --');
{
  const board = await openBoard(playerToMove());
  await board.touchStart('e2');
  await sleep(COMPATIBILITY_MOUSE_WINDOW_MS + 100);
  expectThat(board.isSelected('e2'), 'A player holds a finger on a pawn: it is selected during the hold');
  await board.touchEnd('e2');
  await board.press('e2');
  await board.release('e2');
  expectThat(board.isSelected('e2') && board.hasLegalDot('e4'),
    'A player lifts the finger after a long hold and the browser sends late mouse events: the pawn stays selected');
  await board.close();
}
{
  const board = await openBoard(playerToMove());
  await board.press('e2');
  await board.moveTo('e4');
  await board.moveTo('e2');
  await board.release('e2');
  expectThat(board.selectedSquares().length === 0, 'A player drags a pawn away and back to its square: the selection clears');
  await board.close();
}
{
  const board = await openBoard(playerToMove());
  const insideTheSquare = [8, 0];
  await board.press('e2');
  await board.moveTo('e2', insideTheSquare);
  await board.release('e2', insideTheSquare);
  expectThat(board.isSelected('e2') && board.hasLegalDot('e4'), 'A player wiggles a pawn inside its own square: the selection stays');
  await board.close();
}

console.log(`\n${passes} scenarios passed, ${failures} failed`);
dom.window.close();
if (failures > 0) process.exitCode = 1;
