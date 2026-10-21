'use client';

import { Building2, Plus, RotateCw, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useMe } from '@/client/features/auth';
import { useErrorText } from '@/client/lib/use-error-text';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { HistoryPanel } from './history-panel';
import { HoldersPanel } from './holders-panel';
import { manageableClubs, roleAccess } from '../lib/access';

/**
 * The permissions page: who runs each club and who leads each committee, appointing and removing
 * them, and the history of every change. Full admins and club officers only — a committee lead
 * runs their committee and sees none of this, so the page tells them so instead of an error. An
 * officer opens their own club; a full admin picks any club.
 */
interface PermissionsScreenProps {
  title: string;
  description: string;
}

export function PermissionsScreen({ title, description }: PermissionsScreenProps) {
  const t = useTranslations('permissions');
  const errorText = useErrorText();
  const me = useMe();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [tab, setTab] = useState('holders');
  const [appointingOfficer, setAppointingOfficer] = useState(false);

  const wrap = (children: ReactNode) => (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
  if (me.isPending) return wrap(<Skeleton className="h-64 w-full" aria-busy />);
  if (me.isError) {
    return wrap(
      <EmptyState
        title={t('states.loadFailed')}
        description={errorText(me.error)}
        action={
          <Button variant="outline" onClick={() => void me.refetch()}>
            <RotateCw aria-hidden />
            {t('states.retry')}
          </Button>
        }
      />,
    );
  }

  const clubs = manageableClubs(me.data);
  const club = clubs.find((candidate) => candidate.id === selectedId) ?? clubs[0];
  if (!club) {
    const canSeeAnyClub = me.data.access.clubs.length > 0;
    return wrap(
      <EmptyState
        icon={ShieldOff}
        title={canSeeAnyClub ? t('states.noAccess.title') : t('states.noClubs.title')}
        description={canSeeAnyClub ? t('states.noAccess.body') : t('states.noClubs.body')}
      />,
    );
  }
  const access = roleAccess(me.data);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />

      {/* Keyed by club so one club's open dialogs and history page never carry over to the next. */}
      <Tabs key={club.id} value={tab} onValueChange={setTab} className="gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="holders">{t('tabs.holders')}</TabsTrigger>
            <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            {/* The club being managed: one control, so the label, the icon and the choice read together. */}
            <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-surface-1 ps-3 text-sm">
              <Building2 className="size-4 text-fg-subtle" aria-hidden />
              <Label id="permissions-club-label" className="text-fg-muted">
                {t('club.label')}
              </Label>
              {clubs.length > 1 ? (
                <Select value={club.id} onValueChange={setSelectedId}>
                  <SelectTrigger
                    className="h-full w-48 rounded-s-none border-0 border-s border-border bg-transparent shadow-none"
                    aria-labelledby="permissions-club-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clubs.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span aria-labelledby="permissions-club-label" className="pe-3 font-semibold">
                  {club.name}
                </span>
              )}
            </div>
            {tab === 'holders' && access.canSetOfficers ? (
              <Button className="h-10" onClick={() => setAppointingOfficer(true)}>
                <Plus aria-hidden />
                {t('officers.appoint')}
              </Button>
            ) : null}
          </div>
        </div>
        <TabsContent value="holders">
          <HoldersPanel
            club={club}
            access={access}
            me={me.data}
            appointingOfficer={appointingOfficer}
            onAppointingOfficerChange={setAppointingOfficer}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistoryPanel clubId={club.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
