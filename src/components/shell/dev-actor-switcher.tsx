'use client';

import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from '@/i18n/navigation';
import { readCookie } from '@/lib/cookies';
import { demoClubs, demoPeople, type DemoPerson } from '@/mocks/data/demo';
import { DEV_ACTOR_COOKIE } from '@/modules/auth/contracts';

/*
 * DEVELOPMENT ONLY. Lets you act as any seeded user by setting the dev actor cookie, which the
 * server honours only in development with DEV_ACTOR_SWITCHER=true (and MSW honours in mock mode).
 * The header loads this component only when NODE_ENV !== 'production', so it is not in
 * production bundles.
 */

const CHANGE_EVENT = 'dm-dev-actor-change';
const GROUPS = ['admins', 'officers', 'mixed', 'leads', 'members'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(person: DemoPerson): Group {
  switch (person.persona) {
    case 'admin':
      return 'admins';
    case 'officer':
      return 'officers';
    case 'mixed':
      return 'mixed';
    case 'lead':
      return 'leads';
    default:
      return 'members';
  }
}

function readActor(): string {
  return readCookie(document.cookie, DEV_ACTOR_COOKIE) ?? '';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

const clubName = (key: string) => demoClubs.find((club) => club.key === key)?.name ?? key;
const committeeName = (clubKey: string, key: string) =>
  demoClubs.find((club) => club.key === clubKey)?.committees.find((c) => c.key === key)?.name ??
  key;

export default function DevActorSwitcher() {
  const t = useTranslations('auth');
  const queryClient = useQueryClient();
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, readActor, () => '');
  const people = demoPeople.filter((person) => person.registered);
  const currentPerson = people.find((person) => person.uniEmail === current);

  function summary(person: DemoPerson): string {
    const parts = person.memberships.flatMap((membership) => {
      if (membership.removedDaysAgo !== undefined) {
        return [t('roleSummary.removedFrom', { club: clubName(membership.club) })];
      }
      const led = membership.committees
        .filter((committee) => committee.lead)
        .map((committee) =>
          t('roleSummary.leadOf', { committee: committeeName(membership.club, committee.key) }),
        );
      if (membership.officer)
        return [t('roleSummary.officerOf', { club: clubName(membership.club) }), ...led];
      return led.length > 0
        ? led
        : [t('roleSummary.memberOf', { club: clubName(membership.club) })];
    });
    if (person.isFullAdmin) parts.unshift(t('roleSummary.fullAdmin'));
    return parts.length > 0 ? parts.join(' · ') : t('roleSummary.none');
  }

  function select(uniEmail: string) {
    document.cookie = uniEmail
      ? `${DEV_ACTOR_COOKIE}=${encodeURIComponent(uniEmail)}; path=/; samesite=lax`
      : `${DEV_ACTOR_COOKIE}=; path=/; max-age=0; samesite=lax`;
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Drop everything cached for the previous persona, then reload server components.
    queryClient.clear();
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-56 border-dashed border-warning text-fg"
          title={t('devSwitcher.hint')}
        >
          <FlaskConical aria-hidden className="text-warning" />
          <span className="truncate">{currentPerson?.fullName ?? t('devSwitcher.signedOut')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-fg">{t('devSwitcher.label')}</span>
          <span className="font-normal">{t('devSwitcher.hint')}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current} onValueChange={select}>
          {GROUPS.map((group) => {
            const members = people.filter((person) => groupOf(person) === group);
            if (members.length === 0) return null;
            return (
              <DropdownMenuGroup key={group}>
                <DropdownMenuLabel>{t(`devSwitcher.groups.${group}`)}</DropdownMenuLabel>
                {members.map((person) => (
                  <DropdownMenuRadioItem
                    key={person.key}
                    value={person.uniEmail}
                    className="items-start"
                  >
                    <span className="grid gap-0.5">
                      <span>{person.fullName}</span>
                      <span className="text-xs text-fg-muted">{summary(person)}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            );
          })}
        </DropdownMenuRadioGroup>
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => select('')}>
              {t('devSwitcher.signOut')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
