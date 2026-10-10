// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { DataTable } from './data-table';
import { createDataTableColumnHelper } from './features';

interface Row {
  id: string;
  name: string;
  points: number;
}

const column = createDataTableColumnHelper<Row>();
const columns = [
  column.accessor('name', { header: 'الاسم', enableSorting: true }),
  column.accessor('points', { header: 'النقاط' }),
];
const rows: Row[] = [
  { id: 'r1', name: 'سارة', points: 30 },
  { id: 'r2', name: 'فهد', points: 12 },
];

function setup(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const props = {
    label: 'جدول تجريبي',
    columns,
    data: rows,
    getRowId: (row: Row) => row.id,
    rowCount: 45,
    pagination: { pageIndex: 0, pageSize: 20 },
    onPaginationChange: vi.fn(),
    sorting: [],
    onSortingChange: vi.fn(),
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<DataTable {...props} />);
  return props;
}

describe('DataTable', () => {
  it('renders rows, headers and the total in Arabic', () => {
    setup();
    expect(screen.getByRole('table', { name: 'جدول تجريبي' })).toBeTruthy();
    expect(screen.getByText('سارة')).toBeTruthy();
    expect(screen.getByText('فهد')).toBeTruthy();
    expect(screen.getByText('45 نتيجة')).toBeTruthy();
    expect(screen.getByText('صفحة 1 من 3')).toBeTruthy();
  });

  it('only makes opted-in columns sortable, and reports sort changes', async () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /النقاط/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /الاسم/ }));
    expect(props.onSortingChange).toHaveBeenCalled();
  });

  it('selects rows and the whole page', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'تحديد كل صفوف هذه الصفحة' }));
    expect(props.onRowSelectionChange).toHaveBeenCalled();
  });

  it('shows bulk actions while rows are selected', () => {
    setup({
      rowSelection: { r1: true },
      bulkActions: ({ ids }) => <button type="button">إجراء على {ids.length}</button>,
    });
    expect(screen.getByText('صف واحد محدد')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إجراء على 1' })).toBeTruthy();
  });

  it('pages forward', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(props.onPaginationChange).toHaveBeenCalled();
  });

  it('shows the empty state when there are no rows', () => {
    setup({ data: [], rowCount: 0, emptyState: 'لا يوجد أعضاء' });
    expect(screen.getByText('لا يوجد أعضاء')).toBeTruthy();
  });
});
