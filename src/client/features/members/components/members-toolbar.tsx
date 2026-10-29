'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/client/lib/utils';
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
  memberGenderFilterSchema,
  memberStatusSchema,
  type ListMembersQuery,
} from '@/shared/contracts/members';

import { CommitteeFilter } from './committee-filter';
import { useClubTypes } from '../hooks/use-member-actions';

const ALL = 'all';

/** One height for the search box and every filter; a filter that narrows the list is tinted. */
const filterClass = (active: boolean) =>
  cn(
    'h-9 w-full gap-2 sm:w-auto',
    active && 'border-primary/50 bg-primary-subtle font-medium text-primary-subtle-fg',
  );

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
    query.registered !== undefined ||
    query.gender ||
    query.from ||
    query.to,
  );

  return (
    <>
      <div className="relative w-full sm:w-72">
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
          className="h-9 ps-9"
        />
      </div>

      {clubs.length > 1 ? (
        <Select
          value={query.clubId ?? ALL}
          onValueChange={(value) =>
            onChange({ clubId: value === ALL ? undefined : value, committeeId: undefined })
          }
        >
          <SelectTrigger className={filterClass(Boolean(query.clubId))} aria-label={t('club')}>
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

      {committees.length > 1 ? (
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
        <SelectTrigger className={filterClass(query.status !== 'active')} aria-label={t('status')}>
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
          <SelectTrigger
            className={filterClass(Boolean(query.membershipTypeId?.length))}
            aria-label={t('membershipType')}
          >
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
        <SelectTrigger className={filterClass(Boolean(query.role))} aria-label={t('role')}>
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
        <SelectTrigger
          className={filterClass(query.registered !== undefined)}
          aria-label={t('registered')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allRegistered')}</SelectItem>
          <SelectItem value="yes">{t('registeredYes')}</SelectItem>
          <SelectItem value="no">{t('registeredNo')}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={query.gender ?? ALL}
        onValueChange={(value) =>
          onChange({ gender: value === ALL ? undefined : memberGenderFilterSchema.parse(value) })
        }
      >
        <SelectTrigger className={filterClass(Boolean(query.gender))} aria-label={t('gender')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allGenders')}</SelectItem>
          <SelectItem value="MALE">{t('genderMale')}</SelectItem>
          <SelectItem value="FEMALE">{t('genderFemale')}</SelectItem>
          <SelectItem value="UNSPECIFIED">{t('genderUnspecified')}</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          className="h-9"
          onClick={() => {
            setSearch('');
            onChange({
              q: undefined,
              clubId: undefined,
              committeeId: undefined,
              membershipTypeId: undefined,
              role: undefined,
              registered: undefined,
              gender: undefined,
              status: 'active',
              from: undefined,
              to: undefined,
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
