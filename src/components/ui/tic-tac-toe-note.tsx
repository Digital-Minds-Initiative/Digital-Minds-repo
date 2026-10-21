'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/client/lib/utils';
import { DoodleCross, DoodleStar, ScrapPaper, Tape } from '@/components/ui/scrapbook';

import {
  computerMove,
  EMPTY_BOARD,
  isFull,
  place,
  winnerOf,
  type Board,
  type Mark,
} from './tic-tac-toe-logic';

export interface TicTacToeLabels {
  /** The handwritten heading: it follows the game. */
  heading: { turn: string; win: string; lose: string; draw: string };
  /** One short line under the board, for people (and a live region for screen readers). */
  status: { yourTurn: string; thinking: string; win: string; lose: string; draw: string };
  /** "I play" — the label for the X / O choice. */
  play: string;
  restart: string;
  /** `الخانة {n}` */
  cell: string;
  empty: string;
}

const COMPUTER_DELAY_MS = 450;

/** Arrow keys move one cell on the screen: the drawing's columns run left to right in every language. */
const ARROW_STEP = {
  ArrowRight: { row: 0, col: 1 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowDown: { row: 1, col: 0 },
  ArrowUp: { row: -1, col: 0 },
} as const;

/** Where each cell's centre is in the 120×120 drawing. */
const CENTRES = [24, 61, 97] as const;
const centre = (index: number) => ({
  x: CENTRES[index % 3] as number,
  y: CENTRES[Math.floor(index / 3)] as number,
});

/** Slightly crooked ruled lines, like drawn with a pencil and no ruler. */
const GRID_PATHS = [
  'M42 8C44 36 40 70 43 112',
  'M80 6C78 40 82 74 79 113',
  'M7 41C38 43 72 39 113 42',
  'M8 80C42 77 74 82 112 79',
];

function MarkDrawing({ mark, index }: { mark: Mark; index: number }) {
  const { x, y } = centre(index);
  const draw = 'motion-safe:animate-[draw-stroke_0.4s_ease-out_both]';
  const common = { pathLength: 1, strokeDasharray: 1 } as const;
  if (mark === 'X') {
    return (
      <g stroke="var(--tuwaiq-indigo)" strokeWidth={4.5} strokeLinecap="round" fill="none">
        <path
          {...common}
          className={draw}
          d={`M${x - 11} ${y - 12}C${x - 4} ${y - 4} ${x + 4} ${y + 4} ${x + 11} ${y + 12}`}
        />
        <path
          {...common}
          className={cn(draw, 'motion-safe:[animation-delay:0.12s]')}
          d={`M${x + 12} ${y - 11}C${x + 4} ${y - 4} ${x - 5} ${y + 5} ${x - 12} ${y + 11}`}
        />
      </g>
    );
  }
  return (
    <path
      {...common}
      className={draw}
      fill="none"
      stroke="var(--uqu-deep-teal)"
      strokeWidth={4.5}
      strokeLinecap="round"
      d={`M${x + 1} ${y - 13}C${x + 14} ${y - 14} ${x + 15} ${y + 11} ${x + 1} ${y + 13}C${x - 13} ${y + 14} ${x - 14} ${y - 10} ${x - 1} ${y - 13}`}
    />
  );
}

/**
 * A playable tic-tac-toe on a cream sheet: you against the computer, X or O (X always moves first),
 * a heading in handwriting that follows the game, and a restart. The game's state lives here only;
 * the paper it sits on is dragged by its edges, never by the buttons.
 */
export function TicTacToeNote({
  labels,
  className,
}: {
  labels: TicTacToeLabels;
  className?: string;
}) {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [human, setHuman] = useState<Mark>('X');
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const win = winnerOf(board);
  const draw = !win && isFull(board);
  const over = Boolean(win) || draw;
  const xMoves = board.filter((cell) => cell === 'X').length;
  const oMoves = board.filter((cell) => cell === 'O').length;
  const next: Mark = xMoves === oMoves ? 'X' : 'O';
  const humanTurn = !over && next === human;

  useEffect(() => {
    if (over || next === human) return;
    const timer = setTimeout(() => {
      setBoard((current) => place(current, computerMove(current, next), next));
    }, COMPUTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [board, over, next, human]);

  const heading = win
    ? win.mark === human
      ? labels.heading.win
      : labels.heading.lose
    : draw
      ? labels.heading.draw
      : labels.heading.turn;
  const status = win
    ? win.mark === human
      ? labels.status.win
      : labels.status.lose
    : draw
      ? labels.status.draw
      : humanTurn
        ? labels.status.yourTurn
        : labels.status.thinking;

  function restart(as: Mark = human) {
    setHuman(as);
    setBoard(EMPTY_BOARD);
  }

  /** One cell in the pressed direction from the focused one; nothing wraps past the edge. */
  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEP[event.key as keyof typeof ARROW_STEP];
    const from = cellRefs.current.findIndex((cell) => cell === document.activeElement);
    if (!step || from < 0) return;
    event.preventDefault();
    const row = Math.floor(from / 3) + step.row;
    const col = (from % 3) + step.col;
    if (row >= 0 && row < 3 && col >= 0 && col < 3) cellRefs.current[row * 3 + col]?.focus();
  }

  const winLine = win
    ? `M${centre(win.line[0]).x} ${centre(win.line[0]).y}L${centre(win.line[2]).x + 1} ${centre(win.line[2]).y - 1}`
    : null;

  return (
    <ScrapPaper tint="cream" fold className={cn('p-3.5 pb-4', className)}>
      <Tape tone="lilac" className="start-7 -top-2.5 -rotate-6" />
      <DoodleStar className="absolute end-3 top-3 size-5 rotate-12 text-club-orange" />
      <DoodleCross className="absolute start-3 bottom-3 size-4 -rotate-6 text-tuwaiq-indigo/70" />

      <p className="m-0 mt-2.5 -rotate-2 text-center font-(family-name:--font-hand) text-[28px] leading-none font-bold text-tuwaiq-indigo">
        {heading}
      </p>

      <div className="relative mx-auto mt-2 aspect-square w-[150px]">
        <svg viewBox="0 0 120 120" className="absolute inset-0 size-full text-on-paper" aria-hidden>
          <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" fill="none">
            {GRID_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          {board.map((mark, index) =>
            mark ? <MarkDrawing key={`${index}${mark}`} mark={mark} index={index} /> : null,
          )}
          {winLine ? (
            <path
              pathLength={1}
              strokeDasharray={1}
              className="motion-safe:animate-[draw-stroke_0.5s_0.25s_ease-out_both]"
              d={winLine}
              fill="none"
              stroke="var(--club-orange)"
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.85}
            />
          ) : null}
        </svg>
        {/* The drawing above is laid out left to right whatever the page direction, so the cells
            over it are too: in a right-to-left page the first cell would sit under the drawing's last. */}
        <div
          dir="ltr"
          onKeyDown={onGridKeyDown}
          className="absolute inset-0 grid grid-cols-3 grid-rows-3"
        >
          {board.map((mark, index) => (
            <button
              key={index}
              ref={(node) => {
                cellRefs.current[index] = node;
              }}
              type="button"
              // Not `disabled`: a disabled button drops focus, and a player on the keyboard would lose
              // their place after every move. Pressing a cell that cannot be played does nothing.
              aria-disabled={over || !humanTurn || mark !== null}
              aria-label={`${labels.cell.replace('{n}', String(index + 1))}، ${mark ?? labels.empty}`}
              onClick={() => {
                if (over || !humanTurn || mark !== null) return;
                setBoard((current) => place(current, index, human));
              }}
              className="cursor-pointer rounded-md outline-none focus-visible:outline-2 focus-visible:outline-tuwaiq-indigo focus-visible:outline-solid aria-disabled:cursor-default aria-[disabled=false]:hover:bg-tuwaiq-lilac/15"
            />
          ))}
        </div>
      </div>

      <p
        role="status"
        aria-live="polite"
        className="mx-auto mt-1.5 mb-0 min-h-5 text-center text-[13px] leading-5 font-semibold"
      >
        {status}
      </p>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        <span className="text-xs text-on-paper-muted">{labels.play}</span>
        {(['X', 'O'] as const).map((mark) => (
          <button
            key={mark}
            type="button"
            aria-pressed={human === mark}
            onClick={() => restart(mark)}
            className={cn(
              'size-7 cursor-pointer rounded-md border font-mono text-sm font-bold transition-colors',
              'outline-none focus-visible:outline-2 focus-visible:outline-tuwaiq-indigo focus-visible:outline-solid',
              human === mark
                ? 'border-tuwaiq-indigo bg-tuwaiq-indigo text-paper-cream'
                : 'border-paper-rule bg-transparent text-on-paper hover:bg-on-paper/10',
            )}
          >
            {mark}
          </button>
        ))}
        <button
          type="button"
          aria-label={labels.restart}
          title={labels.restart}
          onClick={() => restart()}
          className="ms-1 flex size-7 cursor-pointer items-center justify-center rounded-md border border-paper-rule text-on-paper outline-none hover:bg-on-paper/10 focus-visible:outline-2 focus-visible:outline-tuwaiq-indigo focus-visible:outline-solid"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </button>
      </div>
    </ScrapPaper>
  );
}
