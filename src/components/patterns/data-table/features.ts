import {
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';

/** Extra per-column settings understood by DataTable. */
export interface DataTableColumnMeta {
  /** Label in the column-visibility menu (needed when the header is not plain text). */
  label?: string;
  headerClassName?: string;
  cellClassName?: string;
}

/**
 * The table features every DataTable uses. Processing is server-side (manual), so no client row
 * models are registered — the API returns rows already filtered, sorted and paginated.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/*
 * Columns of one table have different value types (string, number, …). TanStack Table itself
 * types a column list as ColumnDef<…, any>; `unknown` would reject typed accessor columns because
 * ColumnDef is invariant in its value type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

/** Column helper bound to DataTable's features: `const column = createDataTableColumnHelper<Member>()`. */
export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}
