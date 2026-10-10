/*
 * Deterministic ids for the demo dataset, so `pnpm db:seed` and the MSW mocks produce the same
 * ids for the same people, clubs and committees.
 */

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex128(key: string): string {
  return [0x811c9dc5, 0x2f6b4e1d, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => fnv1a(key, seed).toString(16).padStart(8, '0'))
    .join('');
}

/** A valid UUID (version 7 layout) derived from `key`. */
export function demoId(key: string): string {
  const hex = hex128(key);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** A cuid2-shaped public id (lowercase letters and digits, starts with a letter). */
export function demoPublicId(key: string): string {
  const digits = BigInt(`0x${hex128(`public:${key}`)}`)
    .toString(36)
    .padStart(24, '0')
    .slice(0, 23);
  return `p${digits}`;
}

/** Small deterministic PRNG (mulberry32) for generating demo point transactions. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
