'use client';

import {
  useTable,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { ColumnVisibilityMenu } from './column-visibility-menu';
import { dataTableFeatures, type DataTableColumn } from './features';
import { DataTablePagination } from './pagination';

const EMPTY_SELECTION: RowSelectionState = {};
const EMPTY_VISIBILITY: ColumnVisibilityState = {};
const SELECT_COLUMN_ID = '__select';

interface DataTableProps<TData extends RowData> {
  /** Stable (module-level or memoised) column definitions. Build them with createDataTableColumnHelper. */
  columns: ReadonlyArray<DataTableColumn<TData>>;
  /** The current page of rows, exactly as the API returned it. */
  data: TData[];
  getRowId: (row: TData) => string;
  /** Total number of rows on the server, across all pages. */
  rowCount: number;

  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;

  /** Passing these enables the checkbox column and bulk actions. */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Passing these enables the column-visibility menu. */
  columnVisibility?: ColumnVisibilityState;
  onColumnVisibilityChange?: OnChangeFn<ColumnVisibilityState>;

  /** First load: shows skeleton rows. */
  isLoading?: boolean;
  /** Background refetch (e.g. after a page change): dims the rows. */
  isFetching?: boolean;
  /** Shown when there are no rows. Defaults to a short message. */
  emptyState?: ReactNode;
  /** Filters and actions shown above the table. */
  toolbar?: ReactNode;
  /** Shown above the table while rows are selected. */
  bulkActions?: (selection: { ids: string[]; clear: () => void }) => ReactNode;
  /** Accessible name of the table. */
  label: string;
  pageSizeOptions?: readonly number[];
}

/**
 * Server-side data table: pagination, sorting and filtering happen in the API; this component
 * renders a page and reports state changes. Keep its state in the URL (see useMembersTableState
 * for the pattern) so pages are shareable and the back button works.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  rowCount,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  isLoading = false,
  isFetching = false,
  emptyState,
  toolbar,
  bulkActions,
  label,
  pageSizeOptions,
}: DataTableProps<TData>) {
  const t = useTranslations('ui.dataTable');
  const selectable = onRowSelectionChange !== undefined;

  const allColumns = useMemo<ReadonlyArray<DataTableColumn<TData>>>(() => {
    if (!selectable) return columns;
    const selectColumn: DataTableColumn<TData> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      meta: { headerClassName: 'w-10', cellClassName: 'w-10' },
      header: ({ table }) => (
        <Checkbox
          aria-label={t('selectAll')}
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t('selectRow')}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
        />
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, selectable, t]);

  const table = useTable({
    features: dataTableFeatures,
    columns: allColumns as Array<DataTableColumn<TData>>,
    data,
    getRowId: (row) => getRowId(row),
    rowCount,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    // Sorting is server-side, so columns opt in (`enableSorting: true`) only for fields the API sorts by.
    defaultColumn: { enableSorting: false },
    enableRowSelection: selectable,
    state: {
      pagination,
      sorting,
      rowSelection: rowSelection ?? EMPTY_SELECTION,
      columnVisibility: columnVisibility ?? EMPTY_VISIBILITY,
    },
    onPaginationChange,
    onSortingChange,
    ...(onRowSelectionChange ? { onRowSelectionChange } : {}),
    ...(onColumnVisibilityChange ? { onColumnVisibilityChange } : {}),
  });

  const selectedIds = Object.keys(rowSelection ?? EMPTY_SELECTION).filter(
    (id) => rowSelection?.[id],
  );
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      {toolbar || onColumnVisibilityChange ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {onColumnVisibilityChange ? <ColumnVisibilityMenu table={table} /> : null}
        </div>
      ) : null}

      {selectable && selectedIds.length > 0 ? (
        <div
          role="region"
          aria-label={t('bulkActions')}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-subtle px-3 py-2 text-sm text-primary-subtle-fg"
        >
          <span className="font-medium">{t('selected', { count: selectedIds.length })}</span>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions?.({ ids: selectedIds, clear: () => table.resetRowSelection(true) })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => table.resetRowSelection(true)}
          >
            {t('clearSelection')}
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <Table aria-label={label} aria-busy={isLoading || isFetching || undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={meta?.headerClassName}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : canSort
                              ? 'none'
                              : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            '-mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-surface-3 hover:text-fg',
                            'outline-none focus-visible:outline-2 focus-visible:outline-ring',
                            sorted && 'text-fg',
                          )}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity')}>
            {isLoading ? (
              Array.from({ length: Math.min(pagination.pageSize, 8) }, (_, index) => (
                <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                  {Array.from({ length: visibleColumnCount }, (_, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount} className="py-10 text-center text-fg-muted">
                  {emptyState ?? t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
    </div>
  );
}
