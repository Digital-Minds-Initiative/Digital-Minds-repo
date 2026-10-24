'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useMe } from '../hooks/use-me';
import { useLogout } from '../hooks/use-sign-in';

function initials(fullName: string): string {
  const parts = fullName.split(' ').filter(Boolean);
  return [parts[0], parts.at(-1)]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.charAt(0))
    .join(' ');
}

export function UserMenu() {
  const t = useTranslations('auth');
  const tRoles = useTranslations('common.roles');
  const { data: me } = useMe();
  const logout = useLogout();
  if (!me) return null;

  const roles = [
    ...(me.user.isFullAdmin ? [tRoles('fullAdmin')] : []),
    ...me.memberships
      .filter((membership) => membership.role === 'CLUB_OFFICER')
      .map((membership) => t('roleSummary.officerOf', { club: membership.club.name })),
    ...me.memberships.flatMap((membership) =>
      membership.committees
        .filter((committee) => committee.role === 'LEAD')
        .map((committee) => t('roleSummary.leadOf', { committee: committee.name })),
    ),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          No aria-label: the button is named by what it shows — the person's name (visually hidden
          on small screens, where only the initials fit) and «الحساب» for screen readers — so the
          spoken name always contains the visible one (axe: label-content-name-mismatch).
        */}
        <Button variant="ghost" className="gap-2 px-2">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-subtle-fg"
          >
            {initials(me.user.fullName)}
          </span>
          <span className="max-w-40 truncate text-sm max-md:sr-only">{me.user.fullName}</span>
          <span className="sr-only">{t('userMenu.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-sm font-semibold text-fg">{me.user.fullName}</span>
          <bdi dir="ltr" className="truncate text-xs font-normal text-fg-muted">
            {me.user.uniEmail}
          </bdi>
        </DropdownMenuLabel>
        {roles.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex flex-wrap gap-1 px-2 py-1.5" aria-label={t('userMenu.roles')}>
              {roles.map((role) => (
                <Badge key={role} variant="primary">
                  {role}
                </Badge>
              ))}
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
          <LogOut aria-hidden className="rtl:-scale-x-100" />
          {t('userMenu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
