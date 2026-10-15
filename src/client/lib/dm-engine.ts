/**
 * Digital Minds design-system engine: the pixel/cell generators and the imperative
 * depth/drag/dock behaviours, ported 1:1 from the kit's bundle.js (cell/glyph/word/seam,
 * punch, tower, stack, drag, cursor, dock). Kept framework-agnostic (DOM-level) because
 * the originals are DOM imperative; React components call these from refs/useEffect.
 */

export type CellFinish = 'solid' | 'outline' | 'perforated';

/** Bounds-checked index access — avoids the forbidden non-null assertion operator. */
function req<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('dm-engine: index out of range');
  return v;
}

const GLYPHS = {
  plus: [
    '...##...',
    '...##...',
    '...##...',
    '########',
    '########',
    '...##...',
    '...##...',
    '...##...',
  ],
  diamond: [
    '........',
    '.######.',
    '#.#..#.#',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
  spark: [
    '...#....',
    '...#....',
    '..###...',
    '#######.',
    '..###...',
    '...#....',
    '...#....',
    '........',
  ],
  khatam: [
    '...##...',
    '.######.',
    '.##..##.',
    '###..###',
    '###..###',
    '.##..##.',
    '.######.',
    '...##...',
  ],
};

const ICONS = {
  home: [
    '...##...',
    '..####..',
    '.######.',
    '########',
    '.#....#.',
    '.#.##.#.',
    '.#.##.#.',
    '.######.',
  ],
  grid: [
    '###.###.',
    '###.###.',
    '###.###.',
    '........',
    '###.###.',
    '###.###.',
    '###.###.',
    '........',
  ],
  people: [
    '..####..',
    '..####..',
    '..####..',
    '........',
    '.######.',
    '########',
    '########',
    '########',
  ],
  card: [
    '########',
    '#......#',
    '#.##...#',
    '#.##.###',
    '#......#',
    '#.####.#',
    '#......#',
    '########',
  ],
  search: [
    '..####..',
    '.#....#.',
    '#......#',
    '#......#',
    '.#....#.',
    '..####.#',
    '......##',
    '.......#',
  ],
  plus: [
    '...##...',
    '...##...',
    '...##...',
    '########',
    '########',
    '...##...',
    '...##...',
    '...##...',
  ],
  trophy: [
    '########',
    '#.####.#',
    '#.####.#',
    '.######.',
    '..####..',
    '...##...',
    '..####..',
    '.######.',
  ],
  building: [
    '.######.',
    '.#.##.#.',
    '.######.',
    '.#.##.#.',
    '.######.',
    '.#.##.#.',
    '.######.',
    '.##..##.',
  ],
  shield: [
    '########',
    '########',
    '###..###',
    '###..###',
    '.######.',
    '.######.',
    '..####..',
    '...##...',
  ],
};

const FONT_5X7 = {
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export type GlyphName = keyof typeof GLYPHS;
export type IconName = keyof typeof ICONS;

export interface CellRect {
  x: number;
  y: number;
  s: number;
  rx: number;
  fill: string;
  finish: CellFinish;
  maskId?: string;
}

/** One cell of the grid: a solid/outline/perforated rounded square. */
function cell(x: number, y: number, s: number, finish: CellFinish = 'solid', r?: number): CellRect {
  return {
    x,
    y,
    s,
    rx: r ?? Math.max(1, s * 0.18),
    fill: 'currentColor',
    finish,
    maskId: finish === 'perforated' ? `m${x}-${y}-${s}` : undefined,
  };
}

/** An 8x8 glyph (plus/diamond/spark/khatam) as a list of cells to render in an SVG. */
export function glyphCells(
  name: GlyphName,
  s: number,
  finish: CellFinish = 'solid',
  gap = 0,
): CellRect[] {
  const rows = GLYPHS[name];
  const out: CellRect[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = req(rows[y]);
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') out.push(cell(x * s + gap / 2, y * s + gap / 2, s - gap, finish));
    }
  }
  return out;
}

/** An 8x8 pixel icon (see ICONS), used by PixelIcon and Dock. */
export function iconCells(name: IconName, s: number): CellRect[] {
  const rows = ICONS[name];
  const out: CellRect[] = [];
  for (let y = 0; y < 8; y++) {
    const row = req(rows[y]);
    for (let x = 0; x < 8; x++) {
      if (row[x] === '#')
        out.push(cell(x * s + 0.3, y * s + 0.3, s - 0.6, 'solid', Math.max(0.6, s * 0.16)));
    }
  }
  return out;
}

type FontChar = keyof typeof FONT_5X7;

/** DIGITAL / MINDS style pixel lettering (5x7 bitmap font), used by SharePoster. */
export function wordCells(
  text: string,
  s: number,
  finish: CellFinish = 'solid',
  gap = 0,
): CellRect[] {
  const out: CellRect[] = [];
  let cx = 0;
  for (const ch of text) {
    const glyph = FONT_5X7[ch as FontChar] ?? FONT_5X7[' '];
    for (let y = 0; y < 7; y++) {
      const row = req(glyph[y]);
      for (let x = 0; x < 5; x++) {
        if (row[x] === '#') out.push(cell(cx + x * s + gap / 2, y * s + gap / 2, s - gap, finish));
      }
    }
    cx += 6 * s;
  }
  return out;
}

export interface SeamRect {
  x: number;
  y: number;
  s: number;
  color: 'a' | 'b';
}

/** The dither seam: two colours trading cells through a 4x4 Bayer ordered dither. No gradients. */
export function seamCells(cols: number, rows: number, s: number, dir: 'h' | 'v' = 'h'): SeamRect[] {
  const out: SeamRect[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = dir === 'v' ? (y + 0.5) / rows : (x + 0.5) / cols;
      if ((req(req(BAYER[y % 4])[x % 4]) + 0.5) / 16 < t)
        out.push({ x: x * s, y: y * s, s, color: 'b' });
    }
  }
  return out;
}

/** FNV-1a-seeded PRNG: same seed (e.g. project code + title) always draws the same punch row. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export interface PunchMark {
  x: number;
  y: number;
  s: number;
  kind: 'cell' | 'dot';
}

/** A deterministic row of punch holes, seeded per project so it never changes between renders. */
export function punchMarks(seed: string, cols: number, rows: number, s: number): PunchMark[] {
  const r = rng(seed);
  const out: PunchMark[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out.push({ x: x * s + 0.5, y: y * s + 0.5, s: s - 1, kind: r() < 0.44 ? 'cell' : 'dot' });
    }
  }
  return out;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Cubic ease-out count-up, matching DM.countUp; jumps straight to the end under reduced motion. */
export function countUp(
  to: number,
  onFrame: (value: number) => void,
  ms = 900,
  reduced = reducedMotion(),
): () => void {
  if (reduced) {
    onFrame(to);
    return () => {};
  }
  let raf = 0;
  let t0: number | null = null;
  const frame = (t: number) => {
    if (t0 === null) t0 = t;
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - p) ** 3;
    onFrame(to * e);
    if (p < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export interface TowerOptions {
  stepY?: number;
  stepZ?: number;
  depth?: number;
}

export interface TowerHandle {
  set(v: number): void;
  destroy(): void;
}

/**
 * The Tower engine: sheets receding in depth. `stage` is the perspective container holding
 * `.tower > [data-tower-card]` children. Wheel, arrow keys, pointer tilt and idle drift move it.
 */
export function attachTower(stage: HTMLElement, options: TowerOptions = {}): TowerHandle {
  const tower = stage.querySelector<HTMLElement>('[data-tower]');
  if (!tower) return { set() {}, destroy() {} };
  const cards = Array.from(tower.children) as HTMLElement[];
  const n = cards.length;
  const sy = options.stepY ?? -30;
  const sz = options.stepZ ?? -110;
  const depth = options.depth ?? 7;
  let p = 0;
  let target = 0;
  let hover = false;
  const idle = !reducedMotion();
  let raf = 0;
  let destroyed = false;

  function layout() {
    for (let i = 0; i < n; i++) {
      let d = i - p;
      d = ((d % n) + n) % n;
      if (d > n - 1.2) d -= n;
      const c = req(cards[i]);
      const vis = d > -1.2 && d < depth;
      const op = !vis
        ? 0
        : d < 0
          ? Math.min(1, Math.max(0, 1 + (d + 0.35) / 0.55))
          : d > depth - 2
            ? Math.max(0, (depth - d) / 2)
            : 1;
      c.style.transform = `translate3d(0, ${d * sy}px, ${d * sz}px)`;
      c.style.opacity = String(op);
      c.style.zIndex = String(1000 - Math.round(d * 10));
      const front = d > -0.5 && d < 0.5;
      c.style.pointerEvents = front ? 'auto' : 'none';
      c.setAttribute('aria-hidden', front ? 'false' : 'true');
    }
  }

  function tick() {
    if (destroyed) return;
    if (!hover && idle) target += 0.0012;
    p += (target - p) * 0.08;
    layout();
    raf = requestAnimationFrame(tick);
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    target += e.deltaY * 0.003;
  };
  const onEnter = () => {
    hover = true;
  };
  const onLeave = () => {
    hover = false;
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      target += 1;
      e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      target -= 1;
      e.preventDefault();
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (reducedMotion()) return;
    const r = stage.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
    const ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
    tower.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    tower.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  };

  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('pointerenter', onEnter);
  stage.addEventListener('pointerleave', onLeave);
  stage.addEventListener('keydown', onKeydown);
  stage.addEventListener('pointermove', onPointerMove);

  layout();
  raf = requestAnimationFrame(tick);

  return {
    set(v: number) {
      target = p = v;
      layout();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerenter', onEnter);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('keydown', onKeydown);
      stage.removeEventListener('pointermove', onPointerMove);
    },
  };
}

/** SheetStack engine: scroll-driven `--depth` per card, consumed by CSS scale/brightness. */
export function attachStack(scroller: HTMLElement): () => void {
  const cards = Array.from(scroller.querySelectorAll<HTMLElement>('[data-stack-card]'));
  let busy = false;

  function update() {
    busy = false;
    if (reducedMotion()) return;
    const top = scroller.getBoundingClientRect().top;
    const rects = cards.map((c) => c.getBoundingClientRect().top - top);
    const sticks = cards.map((c) => parseFloat(getComputedStyle(c).top) || 0);
    cards.forEach((c, i) => {
      let depth = 0;
      for (let j = i + 1; j < cards.length; j++) {
        const h = req(cards[j]).offsetHeight || 1;
        const cover = 1 - (req(rects[j]) - req(sticks[j])) / h;
        depth += Math.max(0, Math.min(1, cover));
      }
      c.style.setProperty('--depth', depth.toFixed(3));
    });
  }

  const onScroll = () => {
    if (!busy) {
      busy = true;
      requestAnimationFrame(update);
    }
  };
  scroller.addEventListener('scroll', onScroll);
  update();
  return () => scroller.removeEventListener('scroll', onScroll);
}

/** Controls on a piece (buttons, links, inputs) keep their own clicks and focus; they never drag it. */
const DRAG_EXEMPT =
  'button, a[href], input, select, textarea, label, [role="checkbox"], [data-no-drag]';

/** Fragments drag engine: pointer-down lifts and straightens a piece; pointer-up settles with its own tilt. */
export function attachDrag(el: HTMLElement, restingTilt: number): () => void {
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  let on = false;
  let z = 10;

  function paint(lifted: boolean) {
    el.style.transform = `translate(${x}px, ${y}px) rotate(${lifted ? 0 : restingTilt}deg) scale(${lifted ? 1.03 : 1})`;
  }
  paint(false);
  el.tabIndex = 0;

  const onPointerDown = (e: PointerEvent) => {
    // A press on a control belongs to the control: no capture, no preventDefault, no drag.
    if (e.target instanceof Element && e.target.closest(DRAG_EXEMPT)) return;
    on = true;
    sx = e.clientX;
    sy = e.clientY;
    ox = x;
    oy = y;
    z += 1;
    el.style.zIndex = String(z);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported */
    }
    el.classList.add('lift');
    paint(true);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!on) return;
    x = ox + (e.clientX - sx);
    y = oy + (e.clientY - sy);
    paint(true);
  };
  const onUp = () => {
    if (!on) return;
    on = false;
    el.classList.remove('lift');
    paint(false);
  };
  const onKeydown = (e: KeyboardEvent) => {
    // Arrow keys move the paper only when the paper itself is focused, not a control inside it.
    if (e.target !== el) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-12, 0],
      ArrowRight: [12, 0],
      ArrowUp: [0, -12],
      ArrowDown: [0, 12],
    };
    const k = step[e.key];
    if (k) {
      x += k[0];
      y += k[1];
      z += 1;
      el.style.zIndex = String(z);
      paint(false);
      e.preventDefault();
    }
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('keydown', onKeydown);

  return () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('keydown', onKeydown);
  };
}

/** A dot that follows the pointer inside a board (Fragments). No-ops under reduced motion. */
export function attachCursor(board: HTMLElement, dot: HTMLElement): () => void {
  if (reducedMotion()) return () => {};
  const onMove = (e: PointerEvent) => {
    const r = board.getBoundingClientRect();
    dot.style.opacity = '1';
    dot.style.transform = `translate(${e.clientX - r.left - 7}px, ${e.clientY - r.top - 7}px)`;
  };
  const onLeave = () => {
    dot.style.opacity = '0';
  };
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerleave', onLeave);
  return () => {
    board.removeEventListener('pointermove', onMove);
    board.removeEventListener('pointerleave', onLeave);
  };
}

/** Dock: items grow toward the pointer, falling off linearly past 120px. */
export function attachDock(root: HTMLElement): () => void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-dock-item]'));
  const onMove = (e: PointerEvent) => {
    if (reducedMotion()) return;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const c = r.left + r.width / 2;
      const d = Math.abs(e.clientX - c);
      it.style.setProperty('--s', (1 + Math.max(0, 1 - d / 120) * 0.6).toFixed(3));
    }
  };
  const onLeave = () => {
    for (const it of items) it.style.setProperty('--s', '1');
  };
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', onLeave);
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
  };
}

export interface SamplePage {
  bg: string;
  fg: string;
  code: string;
  title: string;
}

/** Sample project pages for Tower/Hero previews — always labelled SAMPLE. */
export const SAMPLE_PAGES: SamplePage[] = [
  { bg: 'var(--tuwaiq-indigo)', fg: '#FFFFFF', code: 'A1', title: 'مساعد الجدول الدراسي' },
  { bg: 'var(--paper-teal)', fg: 'var(--on-paper)', code: 'A2', title: 'خريطة القاعات' },
  { bg: 'var(--slab)', fg: 'var(--on-slab)', code: 'A3', title: 'مصنّف العناكب' },
  { bg: 'var(--paper-peach)', fg: 'var(--on-paper)', code: 'B1', title: 'بطاقة العضوية' },
  { bg: 'var(--uqu-deep-teal)', fg: '#FFFFFF', code: 'B2', title: 'منصّة الفعاليات' },
  { bg: 'var(--paper-cream)', fg: 'var(--on-paper)', code: 'B3', title: 'أرشيف الصور' },
  { bg: 'var(--tuwaiq-lilac)', fg: '#121019', code: 'C1', title: 'دليل الطالب الجديد' },
  { bg: 'var(--uqu-dark-cyan)', fg: '#F4F1EA', code: 'C2', title: 'لوحة المتصدرين' },
];
