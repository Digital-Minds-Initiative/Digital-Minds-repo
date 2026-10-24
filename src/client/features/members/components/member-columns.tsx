'use client';

import { Copy, Crown, MoreVertical, ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { cn } from '@/client/lib/utils';
import {
  createDataTableColumnHelper,
  type DataTableColumn,
} from '@/components/patterns/data-table';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toaster';
import type { Me } from '@/shared/contracts/auth';
import { type MemberPointsBasis, type Member } from '@/shared/contracts/members';
import { dateOnlyToDate } from '@/shared/lib/dates';

import { memberAccess } from '../lib/access';

const column = createDataTableColumnHelper<Member>();

/**
 * How a membership type is drawn. Types are the club's own ladder, listed from the top, so the look
 * follows the place on it: the first is gold, the second purple, the third blue, the ones between
 * plain, and the last — the entry level — faint with a dotted edge. A club with only one or two
 * types keeps just the first colours.
 */
function typeBadge(
  order: number,
  count: number | undefined,
): {
  variant: 'warning' | 'primary' | 'info' | 'neutral' | 'outline';
  className?: string;
} {
  if (order === 0) return { variant: 'warning' };
  if (order === 1) return { variant: 'primary' };
  if (count !== undefined && count > 2 && order === count - 1) {
    return { variant: 'outline', className: 'border-dashed text-fg-subtle' };
  }
  if (order === 2) return { variant: 'info' };
  return { variant: 'neutral' };
}

/**
 * Column definitions for the members table. Sorting is opt-in per column and must match a sort
 * field the API accepts (`memberSortFields`): fullName, joinedAt, membershipType.
 */
export interface MemberColumnActions {
  /** The signed-in person, to decide which row actions each member offers. */
  me: Me | undefined;
  onOpen: (member: Member) => void;
  onEdit: (member: Member) => void;
  onRemove: (member: Member) => void;
  /** How many membership types each club has, by club id (to tell the last one apart). */
  typeCounts: ReadonlyMap<string, number>;
  /** The highest points on the page, which gets the emphasis. */
  topPoints: number;
  /** Which points the list shows (a committee, a work-date period), from the list response. */
  pointsBasis: MemberPointsBasis | undefined;
}

export function useMemberColumns({
  me,
  onOpen,
  onEdit,
  onRemove,
  typeCounts,
  topPoints,
  pointsBasis,
}: MemberColumnActions): Array<DataTableColumn<Member>> {
  const t = useTranslations('members');
  const tRoles = useTranslations('common.roles');
  const format = useFormatter();
  const tRow = useTranslations('members.rowActions');
  const periodLabel = useCallback(
    (from: string | null, to: string | null) => {
      const date = (value: string) => format.dateTime(dateOnlyToDate(value), 'dateShort');
      if (from && to) return t('period.between', { from: date(from), to: date(to) });
      if (from) return t('period.since', { from: date(from) });
      return to ? t('period.until', { to: date(to) }) : '';
    },
    [t, format],
  );

  return useMemo(
    () => [
      column.accessor((member) => member.user.fullName, {
        id: 'fullName',
        header: t('columns.member'),
        enableSorting: true,
        enableHiding: false,
        meta: { label: t('columns.member') },
        cell: ({ row }) => (
          <div className="flex min-w-56 items-center gap-3">
            <Avatar name={row.original.user.fullName} />
            <div className="grid min-w-0 gap-0.5">
              <button
                type="button"
                aria-label={tRow('openMember', { name: row.original.user.fullName })}
                onClick={() => onOpen(row.original)}
                className="w-fit max-w-full cursor-pointer truncate rounded-sm text-start text-sm font-semibold text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
              >
                {row.original.user.fullName}
              </button>
              <span className="flex min-w-0 items-center gap-1">
                <bdi dir="ltr" className="truncate text-xs text-fg-muted">
                  {row.original.user.uniEmail}
                </bdi>
                <button
                  type="button"
                  aria-label={tRow('copyEmail', { name: row.original.user.fullName })}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(row.original.user.uniEmail)
                      .then(() => toast.success(tRow('emailCopied')))
                      .catch(() => toast.error(tRow('copyFailed')));
                  }}
                  // Shown when the row is hovered or the button focused, so the table stays calm.
                  className="rounded-sm p-0.5 text-fg-subtle opacity-0 transition-opacity outline-none hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid [tr:hover_&]:opacity-100"
                >
                  <Copy className="size-3.5" aria-hidden />
                </button>
              </span>
              {row.original.removedAt ? (
                <Badge variant="danger" className="mt-0.5 w-fit">
                  {t('status.removed')}
                </Badge>
              ) : null}
            </div>
          </div>
        ),
      }),
      column.accessor((member) => member.club.name, {
        id: 'club',
        header: t('columns.club'),
        meta: { label: t('columns.club') },
      }),
      column.accessor((member) => member.membershipType.name, {
        id: 'membershipType',
        header: t('columns.membershipType'),
        enableSorting: true,
        meta: { label: t('columns.membershipType') },
        cell: ({ row }) => {
          const style = typeBadge(
            row.original.membershipType.order,
            typeCounts.get(row.original.club.id),
          );
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant={style.variant} className={style.className}>
                {row.original.membershipType.name}
              </Badge>
              {/* The management role sits beside the type, so it needs no column of its own. */}
              {row.original.role === 'CLUB_OFFICER' ? (
                <Badge variant="primary">
                  <ShieldCheck aria-hidden />
                  {tRoles('clubOfficer')}
                </Badge>
              ) : null}
            </span>
          );
        },
      }),
      column.display({
        id: 'committees',
        header: t('columns.committees'),
        meta: { label: t('columns.committees') },
        cell: ({ row }) =>
          row.original.committees.length === 0 ? (
            <span className="text-fg-subtle">{t('none')}</span>
          ) : (
            <ul className="flex max-w-80 min-w-44 flex-wrap gap-1.5">
              {row.original.committees.map((committee) => (
                <li key={committee.id} className="max-w-full">
                  <Badge
                    variant={committee.role === 'LEAD' ? 'info' : 'neutral'}
                    className="max-w-full"
                  >
                    {committee.role === 'LEAD' ? <Crown aria-hidden /> : null}
                    <span className="truncate">{committee.name}</span>
                    {committee.role === 'LEAD' ? (
                      <span className="sr-only"> ({t('leadBadge')})</span>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          ),
      }),
      column.accessor('points', {
        header: () => (
          <span className="grid gap-0.5 text-start">
            <span>
              {pointsBasis?.committee
                ? t('columns.pointsIn', { committee: pointsBasis.committee.name })
                : t('columns.points')}
            </span>
            {pointsBasis?.from || pointsBasis?.to ? (
              <span className="text-[11px] font-normal text-fg-subtle">
                {periodLabel(pointsBasis.from, pointsBasis.to)}
              </span>
            ) : null}
          </span>
        ),
        enableSorting: true,
        meta: { label: t('columns.points') },
        cell: ({ getValue }) => {
          const points = getValue();
          return (
            <Badge
              variant={
                points < 0 ? 'danger' : points > 0 && points === topPoints ? 'warning' : 'outline'
              }
              className={cn(
                'font-mono [direction:ltr]',
                points > 0 && points === topPoints && 'font-bold',
              )}
            >
              {format.number(points, 'integer')}
            </Badge>
          );
        },
      }),
      column.accessor((member) => member.profile.phone, {
        id: 'phone',
        header: t('columns.phone'),
        meta: { label: t('columns.phone') },
        cell: ({ getValue }) => {
          const phone = getValue();
          return phone ? (
            <bdi dir="ltr">{phone}</bdi>
          ) : (
            <span className="text-fg-subtle">{t('none')}</span>
          );
        },
      }),
      column.accessor((member) => member.profile.personalEmail, {
        id: 'personalEmail',
        header: t('columns.personalEmail'),
        meta: { label: t('columns.personalEmail') },
        cell: ({ getValue }) => {
          const email = getValue();
          return email ? (
            <bdi dir="ltr">{email}</bdi>
          ) : (
            <span className="text-fg-subtle">{t('none')}</span>
          );
        },
      }),
      column.accessor((member) => member.profile.college, {
        id: 'college',
        header: t('columns.college'),
        meta: { label: t('columns.college') },
        cell: ({ getValue }) => getValue() ?? t('none'),
      }),
      column.accessor((member) => member.profile.major, {
        id: 'major',
        header: t('columns.major'),
        meta: { label: t('columns.major') },
        cell: ({ getValue }) => getValue() ?? t('none'),
      }),
      column.accessor((member) => member.profile.level, {
        id: 'level',
        header: t('columns.level'),
        meta: { label: t('columns.level') },
        cell: ({ getValue }) => {
          const level = getValue();
          return level === null ? t('none') : t('levelValue', { level });
        },
      }),
      column.accessor('joinedAt', {
        header: t('columns.joinedAt'),
        enableSorting: true,
        meta: { label: t('columns.joinedAt'), cellClassName: 'whitespace-nowrap' },
        cell: ({ getValue }) => format.dateTime(new Date(getValue()), 'dateShort'),
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">{tRow('column')}</span>,
        enableHiding: false,
        meta: { label: tRow('column') },
        cell: ({ row }) => {
          const member = row.original;
          const access = me ? memberAccess(me, member) : null;
          const canEdit =
            !member.removedAt && access !== null && (access.canManage || access.canChangeType);
          const canRemove = !member.removedAt && access?.canManage === true;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-fg-muted hover:text-fg"
                  aria-label={tRow('label', { name: member.user.fullName })}
                >
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpen(member)}>{tRow('open')}</DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem onSelect={() => onEdit(member)}>
                    {tRow('edit')}
                  </DropdownMenuItem>
                ) : null}
                {canRemove ? (
                  <DropdownMenuItem onSelect={() => onRemove(member)}>
                    {tRow('remove')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [
      t,
      tRoles,
      tRow,
      format,
      me,
      onOpen,
      onEdit,
      onRemove,
      typeCounts,
      topPoints,
      pointsBasis,
      periodLabel,
    ],
  );
}
