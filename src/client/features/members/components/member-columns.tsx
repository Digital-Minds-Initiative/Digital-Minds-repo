'use client';

import { Crown, ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import {
  createDataTableColumnHelper,
  type DataTableColumn,
} from '@/components/patterns/data-table';
import { Badge } from '@/components/ui/badge';
import type { Member } from '@/shared/contracts/members';

const column = createDataTableColumnHelper<Member>();

/**
 * Column definitions for the members table. Sorting is opt-in per column and must match a sort
 * field the API accepts (`memberSortFields`): fullName, joinedAt, membershipType.
 */
export function useMemberColumns(): Array<DataTableColumn<Member>> {
  const t = useTranslations('members');
  const tRoles = useTranslations('common.roles');
  const format = useFormatter();

  return useMemo(
    () => [
      column.accessor((member) => member.user.fullName, {
        id: 'fullName',
        header: t('columns.member'),
        enableSorting: true,
        enableHiding: false,
        meta: { label: t('columns.member') },
        cell: ({ row }) => (
          <div className="grid min-w-48 gap-0.5">
            <span className="font-medium text-fg">{row.original.user.fullName}</span>
            <bdi dir="ltr" className="truncate text-xs text-fg-muted">
              {row.original.user.uniEmail}
            </bdi>
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
        cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
      }),
      column.display({
        id: 'role',
        header: t('columns.role'),
        meta: { label: t('columns.role') },
        cell: ({ row }) =>
          row.original.role === 'CLUB_OFFICER' ? (
            <Badge variant="primary">
              <ShieldCheck aria-hidden />
              {tRoles('clubOfficer')}
            </Badge>
          ) : (
            <span className="text-fg-subtle">{t('none')}</span>
          ),
      }),
      column.display({
        id: 'committees',
        header: t('columns.committees'),
        meta: { label: t('columns.committees') },
        cell: ({ row }) =>
          row.original.committees.length === 0 ? (
            <span className="text-fg-subtle">{t('none')}</span>
          ) : (
            <ul className="flex max-w-72 flex-wrap gap-1">
              {row.original.committees.map((committee) => (
                <li key={committee.id}>
                  <Badge variant={committee.role === 'LEAD' ? 'info' : 'neutral'}>
                    {committee.role === 'LEAD' ? <Crown aria-hidden /> : null}
                    {committee.name}
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
        header: t('columns.points'),
        meta: { label: t('columns.points'), cellClassName: 'tabular-nums font-medium' },
        cell: ({ getValue }) => format.number(getValue(), 'integer'),
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
      column.display({
        id: 'status',
        header: t('columns.status'),
        meta: { label: t('columns.status') },
        cell: ({ row }) =>
          row.original.removedAt ? (
            <Badge variant="danger">{t('status.removed')}</Badge>
          ) : row.original.user.isRegistered ? (
            <Badge variant="success">{t('status.registered')}</Badge>
          ) : (
            <Badge variant="warning">{t('status.notRegistered')}</Badge>
          ),
      }),
      column.accessor('joinedAt', {
        header: t('columns.joinedAt'),
        enableSorting: true,
        meta: { label: t('columns.joinedAt'), cellClassName: 'whitespace-nowrap' },
        cell: ({ getValue }) => format.dateTime(new Date(getValue()), 'dateShort'),
      }),
    ],
    [t, tRoles, format],
  );
}
