import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { DataTable } from './data-table';
import { createDataTableColumnHelper, type DataTableColumn } from './features';
import type {
  ColumnVisibilityState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from './index';

interface DemoMember {
  id: string;
  name: string;
  committee: string;
  points: number;
}

const NAMES = [
  'سارة القحطاني',
  'فهد العنزي',
  'نورة الحربي',
  'محمد العتيبي',
  'ريم الشهري',
  'خالد المالكي',
  'جود الأحمدي',
  'ماجد السلمي',
  'فيصل الدوسري',
  'لمى السبيعي',
  'عمر باوزير',
  'أسماء الثبيتي',
  'يوسف الشمراني',
  'بندر الزهراني',
  'شهد المطيري',
  'وعد البقمي',
  'ريان الحربي',
  'غدير المحمادي',
  'نايف الرشيدي',
  'دانة الخزاعي',
  'حصة العسيري',
  'إبراهيم الصاعدي',
  'عبدالرحمن القرشي',
];
const COMMITTEES = ['لجنة البرمجة', 'لجنة التصميم', 'لجنة الفعاليات'];
const ALL: DemoMember[] = NAMES.map((name, index) => ({
  id: `m${index}`,
  name,
  committee: COMMITTEES[index % COMMITTEES.length] ?? '',
  points: (index * 37) % 120,
}));

const column = createDataTableColumnHelper<DemoMember>();
const columns: Array<DataTableColumn<DemoMember>> = [
  column.accessor('name', {
    header: 'الاسم',
    enableSorting: true,
    enableHiding: false,
    meta: { label: 'الاسم' },
  }),
  column.accessor('committee', {
    header: 'اللجنة',
    meta: { label: 'اللجنة' },
    cell: ({ getValue }) => <Badge>{getValue()}</Badge>,
  }),
  column.accessor('points', {
    header: 'النقاط',
    enableSorting: true,
    meta: { label: 'النقاط', cellClassName: 'tabular-nums' },
  }),
];

/** Simulates the server: filters, sorts and slices like the API does. */
function DataTableDemo({ loading = false }: { loading?: boolean }) {
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});

  const filtered = useMemo(() => ALL.filter((member) => member.name.includes(search)), [search]);
  const page = useMemo(() => {
    const [sort] = sorting;
    const sorted = [...filtered].sort((a, b) => {
      if (!sort) return 0;
      const result =
        sort.id === 'points' ? a.points - b.points : a.name.localeCompare(b.name, 'ar');
      return sort.desc ? -result : result;
    });
    const start = pagination.pageIndex * pagination.pageSize;
    return sorted.slice(start, start + pagination.pageSize);
  }, [filtered, sorting, pagination]);

  return (
    <DataTable
      label="أعضاء تجريبيون"
      columns={columns}
      data={loading ? [] : page}
      getRowId={(row) => row.id}
      rowCount={filtered.length}
      pagination={pagination}
      onPaginationChange={setPagination}
      sorting={sorting}
      onSortingChange={setSorting}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
      isLoading={loading}
      pageSizeOptions={[5, 10, 20]}
      toolbar={
        <Input
          className="w-64"
          placeholder="ابحث بالاسم"
          aria-label="بحث"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPagination((current) => ({ ...current, pageIndex: 0 }));
          }}
        />
      }
      bulkActions={() => (
        <Button size="sm" variant="outline">
          <Copy aria-hidden />
          نسخ البريد
        </Button>
      )}
    />
  );
}

const meta = {
  title: 'Patterns/DataTable',
  component: DataTableDemo,
} satisfies Meta<typeof DataTableDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServerSide: Story = {};

export const Loading: Story = { args: { loading: true } };
