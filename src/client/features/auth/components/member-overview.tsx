'use client';

import { Crown, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { Me } from '@/shared/contracts/auth';

/**
 * The home page of someone who manages nothing: a greeting and, for each club they are in, their
 * membership type and their committees. Only what `/me` says about the caller — a member reads no
 * one else's data and none of the management screens. `memberships` holds active memberships only,
 * so a club someone was removed from is not listed.
 */
export function MemberOverview({ me }: { me: Me }) {
  const t = useTranslations('auth.member');
  const tRoles = useTranslations('common.roles');
  const { memberships, user } = me;

  return (
    <div className="grid gap-6">
      <section className="flex items-center gap-4 rounded-card border border-border bg-surface-1 p-5">
        <Avatar name={user.fullName} />
        <div className="grid gap-0.5">
          <h2 className="text-lg font-semibold">{t('welcome', { name: user.fullName })}</h2>
          <p className="text-sm text-fg-muted">{t('welcomeBody')}</p>
        </div>
      </section>

      {memberships.length === 0 ? (
        <EmptyState icon={UsersRound} title={t('noClub.title')} description={t('noClub.body')} />
      ) : (
        <section aria-label={t('clubs')} className="grid gap-3">
          <h2 className="text-base font-semibold">{t('clubs')}</h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] items-start gap-3 p-0">
            {memberships.map((membership) => (
              <li
                key={membership.club.id}
                className="grid gap-3 rounded-card border border-border bg-surface-1 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{membership.club.name}</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="success">{t('active')}</Badge>
                    <Badge variant="outline">{membership.membershipType.name}</Badge>
                  </div>
                </div>
                <div className="grid gap-2 border-t border-border/60 pt-3">
                  <p className="text-xs font-medium text-fg-muted">{t('committees')}</p>
                  {membership.committees.length === 0 ? (
                    <p className="text-sm text-fg-muted">{t('noCommittees')}</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {membership.committees.map((committee) => (
                        <li key={committee.id}>
                          <Badge variant={committee.role === 'LEAD' ? 'info' : 'neutral'}>
                            {committee.role === 'LEAD' ? <Crown aria-hidden /> : null}
                            {committee.name}
                            <span className="text-fg-subtle">
                              {' · '}
                              {committee.role === 'LEAD'
                                ? tRoles('committeeLead')
                                : tRoles('member')}
                            </span>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
