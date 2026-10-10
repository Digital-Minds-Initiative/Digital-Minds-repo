// @vitest-environment jsdom
import {
  functionalUpdate,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

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

/** Applies the updater the table last passed to an onChange callback. */
function lastUpdate<T>(onChange: Mock<OnChangeFn<T>>, previous: T): T {
  const updater: Updater<T> | undefined = onChange.mock.lastCall?.[0];
  if (updater === undefined) throw new Error('onChange was not called');
  return functionalUpdate(updater, previous);
}

const FIRST_PAGE: PaginationState = { pageIndex: 0, pageSize: 20 };

function setup(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const callbacks = {
    onPaginationChange: vi.fn<OnChangeFn<PaginationState>>(),
    onSortingChange: vi.fn<OnChangeFn<SortingState>>(),
    onRowSelectionChange: vi.fn<OnChangeFn<RowSelectionState>>(),
  };
  renderWithProviders(
    <DataTable
      label="جدول تجريبي"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      rowCount={45}
      pagination={FIRST_PAGE}
      sorting={[]}
      rowSelection={{}}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
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
    expect(lastUpdate(props.onSortingChange, [])).toEqual([{ id: 'name', desc: false }]);
  });

  it('selects rows and the whole page', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'تحديد كل صفوف هذه الصفحة' }));
    expect(lastUpdate(props.onRowSelectionChange, {})).toEqual({ r1: true, r2: true });
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
    expect(lastUpdate(props.onPaginationChange, FIRST_PAGE)).toEqual({
      pageIndex: 1,
      pageSize: 20,
    });
  });

  it('shows the empty state when there are no rows', () => {
    setup({ data: [], rowCount: 0, emptyState: 'لا يوجد أعضاء' });
    expect(screen.getByText('لا يوجد أعضاء')).toBeTruthy();
  });
});
