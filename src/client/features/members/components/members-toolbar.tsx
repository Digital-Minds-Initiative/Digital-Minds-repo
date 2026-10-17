'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Me } from '@/shared/contracts/auth';
import {
  clubRoleSchema,
  memberStatusSchema,
  type ListMembersQuery,
} from '@/shared/contracts/members';

import { CommitteeFilter } from './committee-filter';
import { useClubTypes } from '../hooks/use-member-actions';

const ALL = 'all';
const SEARCH_DEBOUNCE_MS = 300;

interface MembersToolbarProps {
  query: ListMembersQuery;
  onChange: (patch: Partial<ListMembersQuery>) => void;
  access: Me['access'] | undefined;
}

export function MembersToolbar({ query, onChange, access }: MembersToolbarProps) {
  const t = useTranslations('members.filters');
  const tCommon = useTranslations('common.actions');
  const [search, setSearch] = useState(query.q ?? '');

  // Push the search to the URL once typing pauses.
  useEffect(() => {
    const next = search.trim() || undefined;
    if (next === query.q) return;
    const timer = setTimeout(() => onChange({ q: next }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query.q, onChange]);

  const clubs = access?.clubs ?? [];
  // Membership types belong to a club, so they are offered once the club is known: chosen, or the only one.
  const typesClubId = query.clubId ?? (clubs.length === 1 ? clubs[0]?.id : undefined);
  const types = useClubTypes(typesClubId);
  const committees = (access?.committees ?? []).filter(
    (committee) => !query.clubId || committee.clubId === query.clubId,
  );
  const hasFilters = Boolean(
    query.q ||
    query.clubId ||
    query.committeeId ||
    query.status !== 'active' ||
    query.membershipTypeId?.length ||
    query.role ||
    query.registered !== undefined,
  );

  return (
    <>
      <div className="relative min-w-64 flex-[2_1_20rem]">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="ps-9"
        />
      </div>

      {clubs.length > 1 ? (
        <Select
          value={query.clubId ?? ALL}
          onValueChange={(value) =>
            onChange({ clubId: value === ALL ? undefined : value, committeeId: undefined })
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t('club')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allClubs')}</SelectItem>
            {clubs.map((club) => (
              <SelectItem key={club.id} value={club.id}>
                {club.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {committees.length > 0 ? (
        <CommitteeFilter
          committees={committees}
          selected={query.committeeId}
          onChange={(committeeId) => onChange({ committeeId })}
        />
      ) : null}

      <Select
        value={query.status}
        onValueChange={(value) => onChange({ status: memberStatusSchema.parse(value) })}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t('status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t('statusActive')}</SelectItem>
          <SelectItem value="removed">{t('statusRemoved')}</SelectItem>
          <SelectItem value="all">{t('statusAll')}</SelectItem>
        </SelectContent>
      </Select>

      {(types.data?.items.length ?? 0) > 0 ? (
        <Select
          value={query.membershipTypeId?.[0] ?? ALL}
          onValueChange={(value) =>
            onChange({ membershipTypeId: value === ALL ? undefined : [value] })
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t('membershipType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allTypes')}</SelectItem>
            {types.data?.items.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select
        value={query.role ?? ALL}
        onValueChange={(value) =>
          onChange({ role: value === ALL ? undefined : clubRoleSchema.parse(value) })
        }
      >
        <SelectTrigger className="w-full sm:w-44" aria-label={t('role')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allRoles')}</SelectItem>
          <SelectItem value="CLUB_OFFICER">{t('roleOfficer')}</SelectItem>
          <SelectItem value="MEMBER">{t('roleMember')}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={query.registered === undefined ? ALL : query.registered ? 'yes' : 'no'}
        onValueChange={(value) =>
          onChange({ registered: value === ALL ? undefined : value === 'yes' })
        }
      >
        <SelectTrigger className="w-full sm:w-44" aria-label={t('registered')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allRegistered')}</SelectItem>
          <SelectItem value="yes">{t('registeredYes')}</SelectItem>
          <SelectItem value="no">{t('registeredNo')}</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            onChange({
              q: undefined,
              clubId: undefined,
              committeeId: undefined,
              membershipTypeId: undefined,
              role: undefined,
              registered: undefined,
              status: 'active',
            });
          }}
        >
          <RotateCcw aria-hidden />
          {tCommon('clearFilters')}
        </Button>
      ) : null}
    </>
  );
}
