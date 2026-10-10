'use client';

import { functionalUpdate } from '@tanstack/react-table';
import { Copy, RotateCw, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { ApiError } from '@/client/lib/api-client';
import {
  DataTable,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from '@/components/patterns/data-table';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import {
  memberSortFields,
  type ListMembersQuery,
  type Member,
  type MemberSortField,
} from '@/shared/contracts/members';

import { useMemberColumns } from './member-columns';
import { MembersToolbar } from './members-toolbar';
import { useMembers } from '../hooks/use-members';
import { useMembersQueryState } from '../hooks/use-members-query-state';

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibilityState = {
  phone: false,
  college: false,
  major: false,
  level: false,
};

const getRowId = (member: Member) => member.id;

function isSortField(id: string): id is MemberSortField {
  return (memberSortFields as readonly string[]).includes(id);
}

/** The reference server-side table: URL state → API query → DataTable. */
export function MembersTable() {
  const t = useTranslations('members');
  const tErrors = useTranslations('common.errors');
  const tActions = useTranslations('common.actions');
  const { query, setQuery, defaults } = useMembersQueryState();
  const members = useMembers(query);
  const { data: me } = useMe();
  const columns = useMemberColumns();

  const [columnVisibility, setColumnVisibility] = useState(DEFAULT_COLUMN_VISIBILITY);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Selection belongs to the visible page: clear it whenever the query changes.
  const queryKey = JSON.stringify(query);
  const [selectionQueryKey, setSelectionQueryKey] = useState(queryKey);
  if (selectionQueryKey !== queryKey) {
    setSelectionQueryKey(queryKey);
    setRowSelection({});
  }

  const pagination: PaginationState = { pageIndex: query.page - 1, pageSize: query.pageSize };
  const sorting: SortingState = [{ id: query.sort, desc: query.order === 'desc' }];

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = functionalUpdate(updater, pagination);
    if (next.pageSize !== query.pageSize) setQuery({ pageSize: next.pageSize });
    else setQuery({ page: next.pageIndex + 1 });
  };

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const [next] = functionalUpdate(updater, sorting);
    setQuery(
      next && isSortField(next.id)
        ? { sort: next.id, order: next.desc ? 'desc' : 'asc' }
        : { sort: defaults.sort, order: defaults.order },
    );
  };

  const onFiltersChange = useCallback(
    (patch: Partial<ListMembersQuery>) => setQuery(patch),
    [setQuery],
  );

  async function copyEmails(ids: string[]) {
    const emails = (members.data?.items ?? [])
      .filter((member) => ids.includes(member.id))
      .map((member) => member.user.uniEmail);
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      toast.success(t('bulk.copied', { count: emails.length }));
    } catch {
      toast.error(t('bulk.copyFailed'));
    }
  }

  if (members.isError && !members.data) {
    const code = members.error instanceof ApiError ? members.error.code : 'INTERNAL';
    return (
      <EmptyState
        title={t('error.title')}
        description={tErrors(code)}
        action={
          <Button variant="outline" onClick={() => void members.refetch()}>
            <RotateCw aria-hidden />
            {tActions('retry')}
          </Button>
        }
      />
    );
  }

  const filtered = Boolean(query.q || query.clubId || query.committeeId?.length);

  return (
    <DataTable
      label={t('table.label')}
      columns={columns}
      data={members.data?.items ?? EMPTY_MEMBERS}
      getRowId={getRowId}
      rowCount={members.data?.total ?? 0}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      sorting={sorting}
      onSortingChange={onSortingChange}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
      isLoading={members.isPending}
      isFetching={members.isFetching}
      toolbar={<MembersToolbar query={query} onChange={onFiltersChange} access={me?.access} />}
      bulkActions={({ ids }) => (
        <Button variant="outline" size="sm" onClick={() => void copyEmails(ids)}>
          <Copy aria-hidden />
          {t('bulk.copyEmails')}
        </Button>
      )}
      emptyState={
        <EmptyState
          variant="plain"
          icon={UsersRound}
          title={t('empty.title')}
          description={filtered ? t('empty.filtered') : undefined}
        />
      }
    />
  );
}

const EMPTY_MEMBERS: Member[] = [];
