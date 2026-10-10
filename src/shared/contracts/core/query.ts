import { z } from 'zod';

/*
 * Helpers for query-string fields. A query string only carries strings, and a repeated key
 * (`?committeeId=a&committeeId=b`) arrives as an array. These helpers accept both the typed value
 * (what the API client sends) and its string form (what the server receives), so the same schema
 * serves both sides.
 */

/** Integer that may arrive as a string. */
export function queryInt({ min, max }: { min: number; max: number }) {
  return z
    .union([z.number(), z.string().regex(/^-?\d+$/)])
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

/** Boolean that may arrive as "true" / "false". */
export function queryBoolean() {
  return z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true');
}

/** One or many values; always an array after parsing. */
export function queryArray<T extends z.ZodType>(item: T, { max = 50 }: { max?: number } = {}) {
  return z
    .union([item, z.array(item).max(max)])
    .transform((value): Array<z.output<T>> =>
      Array.isArray(value) ? (value as Array<z.output<T>>) : [value as z.output<T>],
    );
}

/** Free-text search. Trimmed; an empty string means "not set". */
export function querySearch({ max = 100 }: { max?: number } = {}) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
}

/**
 * Turns query values into URLSearchParams: arrays become repeated keys, undefined/null are
 * dropped. The inverse of `searchParamsToObject` below.
 */
export function toSearchParams(query: Record<string, unknown> | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

/**
 * URLSearchParams → plain object for Zod. A key that appears once becomes a string; a repeated
 * key becomes an array. Used by the route wrapper, URL-synced table state and MSW mocks.
 */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return result;
}
