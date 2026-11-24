import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CardVariant } from '@/shared/lib/member-card';

import { ART_THEMES, type ArtTheme } from './art-theme';
import { composite, decodePng, hexToRgb, Raster, scaleToHeight, tint, type Rgb } from './png';

/**
 * The pictures a wallet pass is made of, drawn from the design system: the gradient panel with its
 * grain (the badge's panel, as a strip), the club's own logo, and the website's pixel head as the
 * pass logo and icon. Sizes are Apple's (Human Interface Guidelines → Wallet → Pass images): strip
 * 375 × 144 pt, logo 50 pt high, icon 38 pt. Google's hero is 1032 × 336 px.
 */

const cache = new Map<string, Raster>();

/** An image from `public/`, decoded once. The wallet routes trace `public/clubs` and `public/brand`. */
function publicImage(path: string): Raster {
  const cached = cache.get(path);
  if (cached) return cached;
  const image = decodePng(readFileSync(join(process.cwd(), 'public', path)));
  cache.set(path, image);
  return image;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Blob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: Rgb;
  strength: number;
}

/**
 * The gradient panel: a base colour, three soft blobs of light, and film grain. The grain is
 * quantised to a few levels and drawn in blocks, which keeps the file small and still reads as
 * grain.
 */
function panel(theme: ArtTheme, width: number, height: number, variant: string): Raster {
  const base = hexToRgb(theme.panelBase);
  const [c0, c1, c2] = theme.blobs.map(hexToRgb) as [Rgb, Rgb, Rgb];
  const blobs: Blob[] = [
    {
      cx: 0.84 * width,
      cy: 0.02 * height,
      rx: 0.5 * width,
      ry: 0.95 * height,
      color: c0,
      strength: 0.95,
    },
    {
      cx: 0.08 * width,
      cy: 1.05 * height,
      rx: 0.6 * width,
      ry: 1.0 * height,
      color: c1,
      strength: 0.9,
    },
    {
      cx: 0.42 * width,
      cy: 0.5 * height,
      rx: 0.3 * width,
      ry: 0.55 * height,
      color: c2,
      strength: 0.7,
    },
  ];
  const seed = seedOf(variant);
  const amplitude = theme.light ? 9 : 12;
  const raster = new Raster(width, height);
  const block = Math.max(1, Math.round(width / 375));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = base.r;
      let g = base.g;
      let b = base.b;
      for (const blob of blobs) {
        const d = Math.hypot((x - blob.cx) / blob.rx, (y - blob.cy) / blob.ry);
        const a = smooth(1 - d) * blob.strength;
        if (a <= 0) continue;
        r += (blob.color.r - r) * a;
        g += (blob.color.g - g) * a;
        b += (blob.color.b - b) * a;
      }
      const level =
        Math.round((hash(Math.floor(x / block), Math.floor(y / block), seed) - 0.5) * 4) / 2;
      const grain = level * amplitude;
      const i = (y * width + x) * 4;
      raster.data[i] = Math.max(0, Math.min(255, Math.round(r + grain)));
      raster.data[i + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
      raster.data[i + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
      raster.data[i + 3] = 255;
    }
  }
  return raster;
}

/** The strip (Apple) or hero (Google): the gradient panel with the club's logo centred at the top. */
export function stripArt(variant: CardVariant, width: number, height: number): Raster {
  const theme = ART_THEMES[variant];
  const art = panel(theme, width, height, variant);
  const logo = scaleToHeight(publicImage(theme.logo), Math.round(height * 0.34));
  composite(art, logo, Math.round((width - logo.width) / 2), Math.round(height * 0.1));
  return art;
}

/** The website's pixel head in the variant's mark colour, `height` pixels tall, transparent. */
export function markLogo(variant: CardVariant, height: number): Raster {
  const theme = ART_THEMES[variant];
  return tint(scaleToHeight(publicImage('brand/mark-mask.png'), height), hexToRgb(theme.mark));
}

/** A square: the pass's ground with the pixel head centred on it (the icon, and Google's logo). */
export function markSquare(variant: CardVariant, size: number): Raster {
  const theme = ART_THEMES[variant];
  const square = new Raster(size, size);
  square.fillRect(0, 0, size, size, hexToRgb(theme.ground));
  const mark = markLogo(variant, Math.round(size * 0.64));
  composite(
    square,
    mark,
    Math.round((size - mark.width) / 2),
    Math.round((size - mark.height) / 2),
  );
  return square;
}

export const STRIP_SIZE = { width: 375, height: 144 } as const;
export const HERO_SIZE = { width: 1032, height: 336 } as const;
