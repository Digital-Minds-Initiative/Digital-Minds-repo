import { glyphCells } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * Pixel-art stickers: small multi-colour drawings on the same cell grid as the logo mark, cut out
 * with a one-cell cream outline like a sticker sheet. Each drawing is rows of letters; every
 * letter is a colour from PALETTE (all brand tokens, so nothing here is a literal colour).
 * Decorative — they never carry meaning of their own.
 */
const PALETTE: Record<string, string> = {
  P: 'var(--tuwaiq-indigo)',
  L: 'var(--tuwaiq-lilac)',
  O: 'var(--tuwaiq-orange)',
  D: 'var(--club-orange)',
  T: 'var(--tuwaiq-teal)',
  K: 'var(--uqu-deep-teal)',
  C: 'var(--paper-cream)',
  N: 'var(--deep)',
};
const OUTLINE = 'var(--paper-cream)';

/** The logo set's own 8×8 glyphs, filled with one letter, so the stickers share its shapes. */
function glyphRows(name: Parameters<typeof glyphCells>[0], letter: string): string[] {
  const rows = Array.from({ length: 8 }, () => Array<string>(8).fill('.'));
  for (const cell of glyphCells(name, 1)) (rows[cell.y] as string[])[cell.x] = letter;
  return rows.map((row) => row.join(''));
}

const ARTS = {
  /** The purple pixel symbol. */
  khatam: glyphRows('khatam', 'P'),
  diamond: glyphRows('diamond', 'L'),
  plus: ['..OCO..', '..OOO..', 'OOOOOOO', 'OOOOOOO', 'OOOOOOO', '..OOO..', '..OOO..'],
  briefcase: [
    '...TTT...',
    '..T...T..',
    'TTTTTTTTT',
    'TTTTTTTTT',
    'TTTCCCTTT',
    'TTTTTTTTT',
    'TTTTTTTTT',
  ],
  sparkle: [
    '....L....',
    '...LCL...',
    '...LCL...',
    'LLLLCLLLL',
    'LCCCCCCCL',
    'LLLLCLLLL',
    '...LCL...',
    '...LCL...',
    '....L....',
  ],
  heart: ['.OO.OO.', 'OCOOOOO', 'OOOOOOO', '.OOOOO.', '..OOO..', '...O...'],
  trophy: [
    'OOOOOOOOO',
    'O.OCOOO.O',
    'O.OCOOO.O',
    '.OOOOOOO.',
    '..OOOOO..',
    '...OOO...',
    '....O....',
    '...DDD...',
    '..DDDDD..',
  ],
  bolt: ['...OOO', '..OOO.', '.OOCO.', 'OOOOOO', '..OOO.', '.OOO..', '.OO...'],
  bulb: [
    '..LLL..',
    '.LLLLL.',
    'LLCLLLL',
    'LCLLLLL',
    'LLLLLLL',
    '.LLLLL.',
    '..LLL..',
    '..KKK..',
    '..TTT..',
    '...K...',
  ],
  arrow: ['...TT...', '..TTTT..', '.TTCTTT.', 'TTTTTTTT', '..TTTT..', '..TTTT..', '..TTTT..'],
  flag: [
    'NTTTT..',
    'NTTTTT.',
    'NTTTT..',
    'N......',
    'N......',
    'N......',
    'N......',
    'N......',
    'NNN....',
  ],
  cross: ['..L..', '..L..', 'LLLLL', '..L..', '..L..'],
} as const;

export type PixelStickerName = keyof typeof ARTS;

interface Cell {
  x: number;
  y: number;
  color: string;
}

function build(rows: readonly string[]): { cells: Cell[]; outline: Cell[]; w: number; h: number } {
  const cells: Cell[] = [];
  const filled = new Set<string>();
  rows.forEach((row, y) =>
    [...row].forEach((letter, x) => {
      const color = PALETTE[letter];
      if (color) {
        cells.push({ x, y, color });
        filled.add(`${x},${y}`);
      }
    }),
  );
  // The cut-out edge: every empty cell that touches a filled one, diagonals included.
  const outline: Cell[] = [];
  const seen = new Set<string>();
  for (const { x, y } of cells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${x + dx},${y + dy}`;
        if (filled.has(key) || seen.has(key)) continue;
        seen.add(key);
        outline.push({ x: x + dx, y: y + dy, color: OUTLINE });
      }
    }
  }
  return { cells, outline, w: Math.max(...rows.map((row) => row.length)), h: rows.length };
}

const BUILT = Object.fromEntries(
  Object.entries(ARTS).map(([name, rows]) => [name, build(rows)]),
) as Record<PixelStickerName, ReturnType<typeof build>>;

export function PixelSticker({ name, className }: { name: PixelStickerName; className?: string }) {
  const { cells, outline, w, h } = BUILT[name];
  return (
    <svg
      // One cell of margin on every side holds the outline.
      viewBox={`-1 -1 ${w + 2} ${h + 2}`}
      className={cn('block h-auto w-full overflow-visible', className)}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {outline.map(({ x, y, color }) => (
        <rect key={`o${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />
      ))}
      {cells.map(({ x, y, color }) => (
        <rect key={`c${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />
      ))}
    </svg>
  );
}
