'use client';

import { functionalUpdate } from '@tanstack/react-table';
import { Download, RotateCw, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { apiClient, ApiError } from '@/client/lib/api-client';
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
  listMembersEndpoint,
  memberSortFields,
  type ListMembersQuery,
  type Member,
  type MemberSortField,
} from '@/shared/contracts/members';
import type { MemberExportSelection } from '@/shared/contracts/members-export';

import { EditMemberDialog } from './edit-member-dialog';
import { ExportMembersDialog } from './export-members-dialog';
import { useMemberColumns } from './member-columns';
import { MemberSheet } from './member-sheet';
import { MemberStats } from './member-stats';
import { MembersToolbar } from './members-toolbar';
import { RemoveMemberDialog } from './remove-member-dialog';
import { useTypeCounts } from '../hooks/use-member-stats';
import { useMembers } from '../hooks/use-members';
import { impliedOrder, useMembersQueryState } from '../hooks/use-members-query-state';
import { memberAccess } from '../lib/access';

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibilityState = {
  phone: false,
  personalEmail: false,
  college: false,
  major: false,
  level: false,
};

const getRowId = (member: Member) => member.id;

/** The largest page the API serves: selecting everyone takes the fewest requests. */
const SELECT_ALL_PAGE_SIZE = 100;

function isSortField(id: string): id is MemberSortField {
  return (memberSortFields as readonly string[]).includes(id);
}

/** The reference server-side table: URL state → API query → DataTable. */
export interface MembersTableProps {
  /** The member whose file is open. The page owns it when something outside the table can open one. */
  openId?: string | null;
  onOpenIdChange?: (id: string | null) => void;
}

export function MembersTable({ openId: controlledOpenId, onOpenIdChange }: MembersTableProps = {}) {
  const t = useTranslations('members');
  const tErrors = useTranslations('common.errors');
  const tActions = useTranslations('common.actions');
  const { query, setQuery } = useMembersQueryState();
  const members = useMembers(query);
  const { data: me } = useMe();
  const [ownOpenId, setOwnOpenId] = useState<string | null>(null);
  const openId = controlledOpenId === undefined ? ownOpenId : controlledOpenId;
  const setOpenId = onOpenIdChange ?? setOwnOpenId;
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const typeCounts = useTypeCounts((me?.access.clubs ?? []).map((club) => club.id));
  // Stable, so the columns (and the cells drawn from them) are not rebuilt by every render.
  const onOpen = useCallback((member: Member) => setOpenId(member.id), [setOpenId]);
  const columns = useMemberColumns({
    me,
    onOpen,
    onEdit: setEditing,
    onRemove: setRemoving,
    typeCounts,
    topPoints: Math.max(0, ...(members.data?.items ?? []).map((member) => member.points)),
    pointsBasis: members.data?.pointsBasis,
  });

  const [columnVisibility, setColumnVisibility] = useState(DEFAULT_COLUMN_VISIBILITY);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectingAll, setSelectingAll] = useState(false);
  // True after "select all N": the export then asks for every match instead of a list of ids.
  const [everyoneSelected, setEveryoneSelected] = useState(false);
  const [exportSelection, setExportSelection] = useState<MemberExportSelection | null>(null);
  // Selection belongs to the visible page: clear it whenever the query changes.
  const queryKey = JSON.stringify(query);
  const [selectionQueryKey, setSelectionQueryKey] = useState(queryKey);
  if (selectionQueryKey !== queryKey) {
    setSelectionQueryKey(queryKey);
    setRowSelection({});
    setEveryoneSelected(false);
  }

  const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    setEveryoneSelected(false);
    setRowSelection(updater);
  };

  // A file is one club's: the one filtered on, or the only one the person can see.
  const accessClubs = me?.access.clubs ?? [];
  const exportClubId = query.clubId ?? (accessClubs.length === 1 ? accessClubs[0]?.id : undefined);
  const { page: _page, pageSize: _pageSize, clubId: _clubId, ...exportFilters } = query;
  const visibleColumnIds = columns.flatMap((column) => {
    const id = column.id ?? ('accessorKey' in column ? column.accessorKey : undefined);
    return typeof id === 'string' && columnVisibility[id] !== false ? [id] : [];
  });

  function openExport(selection: MemberExportSelection) {
    if (exportClubId === undefined) toast(t('export.pickClub'));
    else setExportSelection(selection);
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
        : impliedOrder(query),
    );
  };

  const onFiltersChange = useCallback(
    (patch: Partial<ListMembersQuery>) => setQuery(patch),
    [setQuery],
  );

  /** Selects every member the filters match, not only the page on screen. */
  async function selectEveryone() {
    setSelectingAll(true);
    try {
      const picked: RowSelectionState = {};
      for (let page = 1, pageCount = 1; page <= pageCount; page += 1) {
        const result = await apiClient.request(listMembersEndpoint, {
          query: { ...query, page, pageSize: SELECT_ALL_PAGE_SIZE },
        });
        for (const member of result.items) picked[member.id] = true;
        pageCount = result.pageCount;
      }
      setRowSelection(picked);
      setEveryoneSelected(true);
    } catch {
      toast.error(t('selection.failed'));
    } finally {
      setSelectingAll(false);
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

  const filtered = Boolean(
    query.q ||
    query.clubId ||
    query.committeeId?.length ||
    query.membershipTypeId?.length ||
    query.role ||
    query.registered !== undefined,
  );

  return (
    <>
      <MemberStats access={me?.access} clubId={query.clubId} />
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
        onRowSelectionChange={onRowSelectionChange}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        isLoading={members.isPending}
        isFetching={members.isFetching}
        toolbar={<MembersToolbar query={query} onChange={onFiltersChange} access={me?.access} />}
        toolbarEnd={
          <Button variant="outline" size="sm" onClick={() => openExport({ kind: 'all' })}>
            <Download aria-hidden />
            {t('export.button')}
          </Button>
        }
        bulkActions={({ ids }) => (
          <>
            {ids.length < (members.data?.total ?? 0) ? (
              <Button
                variant="outline"
                size="sm"
                loading={selectingAll}
                onClick={() => void selectEveryone()}
              >
                {t('selection.selectAll', { count: members.data?.total ?? 0 })}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openExport(everyoneSelected ? { kind: 'all' } : { kind: 'ids', memberIds: ids })
              }
            >
              <Download aria-hidden />
              {t('export.button')}
            </Button>
          </>
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
      <MemberSheet
        memberId={openId}
        onClose={() => setOpenId(null)}
        onEdit={setEditing}
        onRemove={setRemoving}
      />
      <EditMemberDialog
        member={editing}
        access={
          editing && me
            ? memberAccess(me, editing)
            : { canManage: false, canEditEmail: false, canChangeType: false }
        }
        onClose={() => setEditing(null)}
      />
      {exportClubId !== undefined ? (
        <ExportMembersDialog
          open={exportSelection !== null}
          onOpenChange={(open) => {
            if (!open) setExportSelection(null);
          }}
          clubId={exportClubId}
          filters={exportFilters}
          selection={exportSelection ?? { kind: 'all' }}
          visibleColumnIds={visibleColumnIds}
          onRejected={(memberIds) => {
            setEveryoneSelected(false);
            setRowSelection((current) => {
              const next = { ...current };
              for (const id of memberIds) delete next[id];
              return next;
            });
          }}
        />
      ) : null}
      <RemoveMemberDialog
        member={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(memberId) => {
          if (openId === memberId) setOpenId(null);
        }}
      />
    </>
  );
}

const EMPTY_MEMBERS: Member[] = [];
