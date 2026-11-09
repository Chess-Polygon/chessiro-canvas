// The board that scripts/test-interaction-browser.mjs plays in a real browser.
// It is the opponent's turn, so every press on a black piece shows premove dots.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChessiroCanvas, INITIAL_GAME_FEN } from 'chessiro-canvas';

type BoardEvent =
  | { name: 'set'; from: string; to: string }
  | { name: 'unset' }
  | { name: 'onSquareClick'; square: string };

declare global {
  interface Window {
    __log: BoardEvent[];
  }
}

window.__log = [];

const allowDragging = new URLSearchParams(window.location.search).get('allowDragging') !== 'false';

function InteractionFixture() {
  const [premove, setPremove] = useState<[string, string] | null>(null);

  return (
    <div style={{ width: 640 }}>
      <ChessiroCanvas
        position={INITIAL_GAME_FEN}
        turnColor="w"
        movableColor="b"
        allowDragging={allowDragging}
        dests={new Map([['e2', ['e3', 'e4']]])}
        pieceSet={{ id: 'png', name: 'PNG', path: '/fixture-pieces', extension: 'png' }}
        premovable={{
          enabled: true,
          showDests: true,
          current: premove,
          events: {
            set: (from, to) => {
              window.__log.push({ name: 'set', from, to });
              setPremove([from, to]);
            },
            unset: () => {
              window.__log.push({ name: 'unset' });
              setPremove(null);
            },
          },
        }}
        onSquareClick={(square) => window.__log.push({ name: 'onSquareClick', square })}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<InteractionFixture />);
