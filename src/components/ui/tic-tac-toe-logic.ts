/** Pure rules of tic-tac-toe, and a computer opponent that plays sensibly but can be beaten. */

export type Mark = 'X' | 'O';
export type Board = readonly (Mark | null)[];

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const EMPTY_BOARD: Board = Array<null>(9).fill(null);

const otherMark = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

export function winnerOf(
  board: Board,
): { mark: Mark; line: readonly [number, number, number] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return { mark, line };
  }
  return null;
}

export const isFull = (board: Board) => board.every((cell) => cell !== null);

export function place(board: Board, index: number, mark: Mark): Board {
  if (board[index] !== null) return board;
  return board.map((cell, i) => (i === index ? mark : cell));
}

const emptyCells = (board: Board) => board.flatMap((cell, index) => (cell === null ? [index] : []));

/** The cell that would complete a line for `mark`, if there is one. */
function completing(board: Board, mark: Mark): number | null {
  for (const cell of emptyCells(board)) {
    if (winnerOf(place(board, cell, mark))?.mark === mark) return cell;
  }
  return null;
}

/**
 * Win if it can, block if it must, else take the centre, then a corner, then any side. Corners and
 * sides are picked at random, so games differ; it is not a perfect player.
 */
export function computerMove(board: Board, mark: Mark, random: () => number = Math.random): number {
  const win = completing(board, mark);
  if (win !== null) return win;
  const block = completing(board, otherMark(mark));
  if (block !== null) return block;
  if (board[4] === null) return 4;
  const pick = (cells: number[]) => cells[Math.floor(random() * cells.length)] as number;
  const corners = [0, 2, 6, 8].filter((cell) => board[cell] === null);
  if (corners.length > 0) return pick(corners);
  return pick(emptyCells(board));
}
