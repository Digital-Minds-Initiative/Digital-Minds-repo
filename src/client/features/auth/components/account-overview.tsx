'use client';

import { ArrowRight, Building2, ShieldCheck, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';

import { useMe } from '../hooks/use-me';

/** Dashboard home: the actor's roles, what they can manage, and their own memberships. */
export function AccountOverview() {
  const t = useTranslations('auth.overview');
  const tSummary = useTranslations('auth.roleSummary');
  const tCommittee = useTranslations('common.roles');
  const { data: me, isPending } = useMe();

  if (isPending || !me) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    );
  }

  const officerOf = me.memberships.filter((membership) => membership.role === 'CLUB_OFFICER');
  const leadOf = me.memberships.flatMap((membership) =>
    membership.committees
      .filter((committee) => committee.role === 'LEAD')
      .map((committee) => ({ committee, club: membership.club })),
  );

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <CardTitle>{t('roles')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {me.user.isFullAdmin ? (
              <li>
                <Badge variant="primary">{t('fullAdmin')}</Badge>
              </li>
            ) : null}
            {officerOf.map((membership) => (
              <li key={membership.club.id}>
                <Badge variant="primary">
                  {tSummary('officerOf', { club: membership.club.name })}
                </Badge>
              </li>
            ))}
            {leadOf.map(({ committee, club }) => (
              <li key={committee.id}>
                <Badge variant="info">
                  {tSummary('leadOf', { committee: committee.name })} · {club.name}
                </Badge>
              </li>
            ))}
            {!me.user.isFullAdmin && officerOf.length === 0 && leadOf.length === 0 ? (
              <li className="text-sm text-fg-muted">{t('noRoles')}</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Building2 className="size-5 text-primary" aria-hidden />
          <CardTitle>{t('access')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-fg-muted">{t('clubs')}</p>
            {me.access.clubs.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('nothing')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {me.access.clubs.map((club) => (
                  <li key={club.id}>
                    <Badge variant={club.canManage ? 'success' : 'neutral'}>
                      {club.name} · {club.canManage ? t('fullClub') : t('throughCommittee')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-fg-muted">{t('committees')}</p>
            {me.access.committees.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('nothing')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {me.access.committees.map((committee) => (
                  <li key={committee.id}>
                    <Badge variant="outline">{committee.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {me.access.canAccessDashboard ? (
            <Button asChild variant="outline" size="sm" className="justify-self-start">
              <Link href="/dashboard/members">
                <Users aria-hidden />
                {t('membersLink')}
                <DirectionalIcon icon={ArrowRight} />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Users className="size-5 text-primary" aria-hidden />
          <CardTitle>{t('memberships')}</CardTitle>
        </CardHeader>
        <CardContent>
          {me.memberships.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('membershipsEmpty')}</p>
          ) : (
            <ul className="grid gap-3">
              {me.memberships.map((membership) => (
                <li key={membership.club.id} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{membership.club.name}</span>
                    <Badge variant="outline">{membership.membershipType.name}</Badge>
                  </div>
                  {membership.committees.length > 0 ? (
                    <p className="text-xs text-fg-muted">
                      {membership.committees
                        .map((committee) =>
                          committee.role === 'LEAD'
                            ? `${committee.name} (${tCommittee('committeeLead')})`
                            : committee.name,
                        )
                        .join('، ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
