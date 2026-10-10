'use client';

import type { ReactTable, RowData } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAGE_SIZE_OPTIONS } from '@/lib/contracts';

import type { DataTableFeatures } from './features';

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  table: ReactTable<DataTableFeatures, TData>;
  pageSizeOptions?: readonly number[] | undefined;
}) {
  const t = useTranslations('ui.dataTable');
  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = Math.max(table.getPageCount(), 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
      <span aria-live="polite">{t('total', { total: table.getRowCount() })}</span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden>{t('rowsPerPage')}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-20" aria-label={t('rowsPerPage')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span>{t('pageOf', { page: pageIndex + 1, pageCount })}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('firstPage')}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.setPageIndex(0)}
          >
            <DirectionalIcon icon={ChevronsLeft} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('previousPage')}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <DirectionalIcon icon={ChevronLeft} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('nextPage')}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <DirectionalIcon icon={ChevronRight} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('lastPage')}
            disabled={!table.getCanNextPage()}
            onClick={() => table.setPageIndex(pageCount - 1)}
          >
            <DirectionalIcon icon={ChevronsRight} />
          </Button>
        </div>
      </div>
    </div>
  );
}
