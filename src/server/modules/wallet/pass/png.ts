import 'server-only';

import { deflateSync } from 'node:zlib';

import { PNG } from 'pngjs';

/**
 * A PNG encoder for the pass images, so the pass needs no image library and no binary files in the
 * repository: every image is drawn from the design system's own cells (docs/adr/0031-wallet-pass.md).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A raster of RGBA pixels, drawn with whole rectangles — the cell grid has nothing else. */
export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb, alpha = 255): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.width + px) * 4;
        this.data[i] = color.r;
        this.data[i + 1] = color.g;
        this.data[i + 2] = color.b;
        this.data[i + 3] = alpha;
      }
    }
  }

  /**
   * The PNG bytes. Without `alpha` the image is stored as plain RGB, a quarter smaller: right for
   * a ground that is fully painted, like the strip.
   */
  toPng({ alpha = true }: { alpha?: boolean } = {}): Buffer {
    const channels = alpha ? 4 : 3;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = alpha ? 6 : 2; // RGBA or RGB
    const stride = this.width * channels;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const row = y * (stride + 1);
      raw[row] = 0; // filter: none
      if (alpha) {
        raw.set(this.data.subarray(y * this.width * 4, (y + 1) * this.width * 4), row + 1);
      } else {
        for (let x = 0; x < this.width; x++) {
          const from = (y * this.width + x) * 4;
          const to = row + 1 + x * 3;
          raw[to] = this.data[from] ?? 0;
          raw[to + 1] = this.data[from + 1] ?? 0;
          raw[to + 2] = this.data[from + 2] ?? 0;
        }
      }
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** Reads a PNG (any colour type the format allows) into a raster of RGBA pixels. */
export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  const raster = new Raster(png.width, png.height);
  raster.data.set(png.data);
  return raster;
}

/** Whole pixels, area-averaged: the logo scaled to a height, edges kept soft. */
export function scaleToHeight(source: Raster, height: number): Raster {
  const width = Math.max(1, Math.round((source.width * height) / source.height));
  const out = new Raster(width, height);
  const fx = source.width / width;
  const fy = source.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.min(source.width, Math.ceil((x + 1) * fx)));
      const y0 = Math.floor(y * fy);
      const y1 = Math.max(y0 + 1, Math.min(source.height, Math.ceil((y + 1) * fy)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * source.width + sx) * 4;
          const alpha = (source.data[i + 3] ?? 0) / 255;
          r += (source.data[i] ?? 0) * alpha;
          g += (source.data[i + 1] ?? 0) * alpha;
          b += (source.data[i + 2] ?? 0) * alpha;
          a += alpha;
          n += 1;
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = a > 0 ? Math.round(r / a) : 0;
      out.data[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out.data[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** `top` over `base` at (x, y): straight alpha compositing. */
export function composite(base: Raster, top: Raster, x: number, y: number): void {
  for (let ty = 0; ty < top.height; ty++) {
    for (let tx = 0; tx < top.width; tx++) {
      const bx = x + tx;
      const by = y + ty;
      if (bx < 0 || by < 0 || bx >= base.width || by >= base.height) continue;
      const ti = (ty * top.width + tx) * 4;
      const a = (top.data[ti + 3] ?? 0) / 255;
      if (a === 0) continue;
      const bi = (by * base.width + bx) * 4;
      const ba = (base.data[bi + 3] ?? 0) / 255;
      const outA = a + ba * (1 - a);
      for (let c = 0; c < 3; c++) {
        const t = top.data[ti + c] ?? 0;
        const bv = base.data[bi + c] ?? 0;
        base.data[bi + c] = Math.round((t * a + bv * ba * (1 - a)) / (outA || 1));
      }
      base.data[bi + 3] = Math.round(outA * 255);
    }
  }
}

/** The same pixels, every opaque one painted in one colour: a logo in `color`, alpha kept. */
export function tint(source: Raster, color: Rgb): Raster {
  const out = new Raster(source.width, source.height);
  for (let i = 0; i < source.data.length; i += 4) {
    out.data[i] = color.r;
    out.data[i + 1] = color.g;
    out.data[i + 2] = color.b;
    out.data[i + 3] = source.data[i + 3] ?? 0;
  }
  return out;
}
