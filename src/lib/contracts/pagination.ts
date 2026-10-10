import { z } from 'zod';

import { queryInt } from './query';

/*
 * Standard list conventions, used by every list endpoint:
 *   ?page=1&pageSize=20&sort=<field>&order=asc|desc&q=<search>&<filters>
 * Responses: { items, page, pageSize, total, pageCount }.
 * Offset pagination fits admin tables with a total count. Add cursor pagination next to it
 * (not instead of it) when an endless feed needs it.
 */

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof sortOrderSchema>;

/** Spread into a list query object: `z.object({ ...paginationShape, ... })`. */
export const paginationShape = {
  page: queryInt({ min: 1, max: 100_000 }).default(1),
  pageSize: queryInt({ min: 1, max: PAGE_SIZE_MAX }).default(PAGE_SIZE_DEFAULT),
};

/** Sort field (one of `fields`) and direction, with defaults. */
export function sortShape<const F extends readonly [string, ...string[]]>(
  fields: F,
  defaults: { sort: F[number]; order: SortOrder },
) {
  return {
    sort: z.enum(fields).default(defaults.sort),
    order: sortOrderSchema.default(defaults.order),
  };
}

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    pageCount: z.number().int().min(0),
  });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export function pageMeta(total: number, page: number, pageSize: number): PageMeta {
  return { page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
}

/** Prisma-style offset for a page. */
export function pageOffset(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
