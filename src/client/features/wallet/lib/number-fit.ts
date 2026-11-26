/**
 * The font size a figure needs so that it fits in `available` pixels on one line instead of being
 * cut off: its own size while it fits, smaller as it grows (a mono figure is about 0.62 em wide a
 * character, the thousands separator included). So 107 and 12,500 both sit square in the same box.
 */
export function fitFontSize(text: string, base: number, available: number, floor = 18): number {
  if (text.length === 0) return base;
  const fits = Math.floor(available / (text.length * 0.62));
  return Math.max(floor, Math.min(base, fits));
}

/** A figure as the cards print it: Latin digits, grouped in thousands. */
export function formatFigure(value: number): string {
  return value.toLocaleString('en');
}
