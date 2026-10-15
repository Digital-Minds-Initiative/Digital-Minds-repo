import { describe, expect, it } from 'vitest';

import {
  computerMove,
  EMPTY_BOARD,
  isFull,
  place,
  winnerOf,
  type Board,
} from '../tic-tac-toe-logic';

const board = (cells: string): Board =>
  [...cells].map((c) => (c === 'X' || c === 'O' ? c : null)) as Board;

describe('tic-tac-toe logic', () => {
  it('detects a win and a full board', () => {
    expect(winnerOf(board('XXX......'))?.mark).toBe('X');
    expect(winnerOf(EMPTY_BOARD)).toBeNull();
    expect(isFull(board('XOXXOOOXX'))).toBe(true);
  });

  it('does not overwrite a taken cell', () => {
    const b = place(EMPTY_BOARD, 0, 'X');
    expect(place(b, 0, 'O')).toBe(b);
  });

  it('wins when it can, blocks otherwise', () => {
    expect(computerMove(board('OO.XX....'), 'O')).toBe(2);
    expect(computerMove(board('XX..O....'), 'O')).toBe(2);
  });
});
