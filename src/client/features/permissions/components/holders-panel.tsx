'use client';

import { Crown, Plus, RotateCw, ShieldCheck, UserMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import type { Me } from '@/shared/contracts/auth';

import { AppointDialog } from './appoint-dialog';
import {
  useClubCommittees,
  useClubPermissions,
  useSetClubRole,
  useSetCommitteeRole,
} from '../hooks/use-permissions';
import type { RoleAccess } from '../lib/access';

interface HoldersPanelProps {
  club: { id: string; name: string };
  access: RoleAccess;
  me: Me;
  /** The "appoint an officer" button lives in the page's toolbar, so its dialog is opened from there. */
  appointingOfficer: boolean;
  onAppointingOfficerChange: (open: boolean) => void;
}

type Revoking =
  | { kind: 'officer'; memberId: string; name: string }
  | { kind: 'lead'; memberId: string; name: string; committee: { id: string; name: string } };

type Appointing = { kind: 'officer' } | { kind: 'lead'; committee: { id: string; name: string } };

/**
 * Who holds which role in the club right now. Full admins appoint and remove officers; officers
 * and full admins appoint and remove committee leads. A committee with no lead is listed too, with
 * the button to appoint one.
 */
export function HoldersPanel({
  club,
  access,
  me,
  appointingOfficer,
  onAppointingOfficerChange,
}: HoldersPanelProps) {
  const t = useTranslations('permissions');
  const errorText = useErrorText();
  const holders = useClubPermissions(club.id);
  const committees = useClubCommittees(club.id);
  const setClubRole = useSetClubRole();
  const setCommitteeRole = useSetCommitteeRole();
  const [leadAppointing, setLeadAppointing] = useState<Extract<
    Appointing,
    { kind: 'lead' }
  > | null>(null);
  const appointing: Appointing | null =
    leadAppointing ?? (appointingOfficer ? { kind: 'officer' } : null);
  const closeAppointing = () => {
    setLeadAppointing(null);
    onAppointingOfficerChange(false);
  };
  const [revoking, setRevoking] = useState<Revoking | null>(null);

  if (holders.isPending || committees.isPending) {
    return <Skeleton className="h-48 w-full" aria-busy />;
  }
  if (holders.isError || committees.isError) {
    return (
      <EmptyState
        title={t('states.loadFailed')}
        description={errorText(holders.error ?? committees.error)}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void holders.refetch();
              void committees.refetch();
            }}
          >
            <RotateCw aria-hidden />
            {t('states.retry')}
          </Button>
        }
      />
    );
  }

  const { officers, leads } = holders.data;
  // The lists carry membership ids and no account ids, so "you" is the holder with your name.
  const isMe = (fullName: string) => fullName === me.user.fullName;

  return (
    <div className="grid gap-6">
      <section aria-label={t('officers.title')} className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="grid gap-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="size-5 text-primary" aria-hidden />
              {t('officers.title')}
              <Badge variant="neutral">{officers.length}</Badge>
            </h2>
            <p className="text-sm text-fg-muted">
              {t('officers.scope')}{' '}
              <span className="text-fg-subtle">{t('officers.assignedBy')}</span>
            </p>
          </div>
        </div>
        {officers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted">
            {t('officers.empty')}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3 p-0">
            {officers.map((officer) => (
              <li
                key={officer.memberId}
                className="flex items-center gap-3 rounded-card border border-border bg-surface-1 px-3 py-2.5 transition-colors hover:bg-surface-2"
              >
                <Avatar name={officer.fullName} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{officer.fullName}</span>
                    {isMe(officer.fullName) ? (
                      <Badge variant="primary">{t('officers.you')}</Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-fg-muted">{t('officers.roleLabel')}</span>
                </span>
                {access.canSetOfficers ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-fg-muted hover:text-danger"
                    aria-label={t('officers.revokeLabel', { name: officer.fullName })}
                    onClick={() =>
                      setRevoking({
                        kind: 'officer',
                        memberId: officer.memberId,
                        name: officer.fullName,
                      })
                    }
                  >
                    <UserMinus aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('leads.title')} className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Crown className="size-5 text-primary" aria-hidden />
            {t('leads.title')}
            <Badge variant="neutral">{leads.length}</Badge>
          </h2>
          <p className="text-sm text-fg-muted">{t('leads.description')}</p>
        </div>
        {committees.data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted">
            {t('leads.noCommittees')}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] items-start gap-3 p-0">
            {committees.data.items.map((committee) => {
              const committeeLeads = leads.filter((lead) => lead.committee.id === committee.id);
              return (
                <li
                  key={committee.id}
                  className="grid content-start gap-3 rounded-card border border-border bg-surface-1 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">{committee.name}</h3>
                      <Badge variant={committeeLeads.length === 0 ? 'warning' : 'info'}>
                        {t('leads.count', { count: committeeLeads.length })}
                      </Badge>
                    </div>
                    {access.canSetLeads ? (
                      <Button
                        variant={committeeLeads.length === 0 ? 'primary' : 'outline'}
                        size="sm"
                        aria-label={t('leads.appointFor', { committee: committee.name })}
                        onClick={() =>
                          setLeadAppointing({
                            kind: 'lead',
                            committee: { id: committee.id, name: committee.name },
                          })
                        }
                      >
                        <Plus aria-hidden />
                        {t('leads.appoint')}
                      </Button>
                    ) : null}
                  </div>
                  {committeeLeads.length > 0 ? (
                    <ul className="m-0 grid list-none gap-0.5 border-t border-border/60 p-0 pt-2">
                      {committeeLeads.map((lead) => (
                        <li
                          key={lead.memberId}
                          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2"
                        >
                          <Avatar name={lead.fullName} size="sm" />
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-medium">{lead.fullName}</span>
                            {isMe(lead.fullName) ? (
                              <Badge variant="primary">{t('leads.you')}</Badge>
                            ) : null}
                          </span>
                          {access.canSetLeads ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-fg-muted hover:text-danger"
                              aria-label={t('leads.revokeLabel', {
                                name: lead.fullName,
                                committee: committee.name,
                              })}
                              onClick={() =>
                                setRevoking({
                                  kind: 'lead',
                                  memberId: lead.memberId,
                                  name: lead.fullName,
                                  committee: { id: committee.id, name: committee.name },
                                })
                              }
                            >
                              <UserMinus aria-hidden />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="border-t border-border/60 pt-3 text-sm text-fg-muted">
                      {t('leads.empty')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AppointDialog
        key={
          appointing ? (appointing.kind === 'lead' ? appointing.committee.id : 'officer') : 'none'
        }
        open={appointing !== null}
        onOpenChange={(open) => {
          if (!open) closeAppointing();
        }}
        title={
          appointing?.kind === 'lead'
            ? t('appoint.leadTitle', { committee: appointing.committee.name })
            : t('appoint.officerTitle')
        }
        description={
          appointing?.kind === 'lead'
            ? t('appoint.leadDescription')
            : t('appoint.officerDescription', { club: club.name })
        }
        clubId={club.id}
        committeeId={appointing?.kind === 'lead' ? appointing.committee.id : undefined}
        holdsRole={(member) =>
          appointing?.kind === 'lead'
            ? member.committees.some((c) => c.id === appointing.committee.id && c.role === 'LEAD')
            : member.role === 'CLUB_OFFICER'
        }
        onSubmit={async (member) => {
          if (appointing?.kind === 'lead') {
            await setCommitteeRole.mutateAsync({
              memberId: member.id,
              committeeId: appointing.committee.id,
              role: 'LEAD',
            });
            toast.success(t('toasts.leadAppointed'));
          } else {
            await setClubRole.mutateAsync({ memberId: member.id, role: 'CLUB_OFFICER' });
            toast.success(t('toasts.officerAppointed'));
          }
        }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        variant="danger"
        title={
          revoking?.kind === 'lead'
            ? t('revokeConfirm.leadTitle', {
                name: revoking.name,
                committee: revoking.committee.name,
              })
            : t('revokeConfirm.officerTitle', { name: revoking?.name ?? '' })
        }
        description={t(
          revoking?.kind === 'lead' ? 'revokeConfirm.leadBody' : 'revokeConfirm.officerBody',
        )}
        confirmLabel={t('revokeConfirm.confirm')}
        onConfirm={async () => {
          if (!revoking) return;
          if (revoking.kind === 'lead') {
            await setCommitteeRole.mutateAsync({
              memberId: revoking.memberId,
              committeeId: revoking.committee.id,
              role: 'MEMBER',
            });
            toast.success(t('toasts.leadRevoked'));
          } else {
            await setClubRole.mutateAsync({ memberId: revoking.memberId, role: 'MEMBER' });
            toast.success(t('toasts.officerRevoked'));
          }
        }}
      />
    </div>
  );
}
