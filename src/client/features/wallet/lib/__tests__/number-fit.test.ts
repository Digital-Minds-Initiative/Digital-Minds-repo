import { describe, expect, it } from 'vitest';

import { fitFontSize, formatFigure } from '../number-fit';

describe('formatFigure', () => {
  it('groups thousands in Latin digits, so 1250 reads 1,250', () => {
    expect(formatFigure(107)).toBe('107');
    expect(formatFigure(1250)).toBe('1,250');
    expect(formatFigure(1_250_000)).toBe('1,250,000');
    expect(formatFigure(0)).toBe('0');
  });
});

describe('fitFontSize', () => {
  it('keeps the full size while the figure fits its room', () => {
    expect(fitFontSize('107', 44, 150)).toBe(44);
    expect(fitFontSize('1,250', 44, 150)).toBe(44);
  });

  it('shrinks a longer figure so it stays on one line', () => {
    const room = 150;
    for (const figure of ['12,500', '125,000', '1,250,000']) {
      const size = fitFontSize(figure, 44, room);
      expect(size).toBeLessThan(44);
      // A mono figure is about 0.62 em a character: it must not need more than the room.
      expect(figure.length * size * 0.62).toBeLessThanOrEqual(room);
    }
  });

  it('gets smaller the longer the figure, never below the floor, and never bigger than its base', () => {
    expect(fitFontSize('12,500', 44, 150)).toBeGreaterThan(fitFontSize('1,250,000', 44, 150));
    expect(fitFontSize('9,999,999,999', 44, 60)).toBe(18);
    expect(fitFontSize('1', 44, 5000)).toBe(44);
    expect(fitFontSize('', 44, 150)).toBe(44);
  });

  it('gives a wide room the bigger figure', () => {
    expect(fitFontSize('125,000', 56, 300)).toBeGreaterThan(fitFontSize('125,000', 56, 150));
  });
});
