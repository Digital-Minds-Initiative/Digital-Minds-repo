'use client';

import { Maximize2, Plus, QrCode, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CLAIM_LIMITS,
  type CreateClaimBody,
  type StickerClaim,
  type StudioSticker,
} from '@/shared/contracts/stickers';
import { AWARDABLE_STICKER_KEYS, customStickerKey, type StickerRef } from '@/shared/lib/stickers';

import { PassQr } from './pass-qr';
import { Sticker } from './sticker';
import { useClaimActions, useClaimCode, useClaims } from '../hooks/use-custom-stickers';
import { useStickerText } from '../hooks/use-sticker-text';

const DURATIONS = [30, 60, 120, 240, 1440] as const;

/** Seconds left until `iso`, never below zero; ticks once a second while it matters. */
function useSecondsLeft(iso: string, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

/** The code on the room's big screen: it changes about every minute, so a photo of it stops working. */
function ClaimScreen({ claim, onClose }: { claim: StickerClaim; onClose: () => void }) {
  const t = useTranslations('wallet.claims');
  const text = useStickerText();
  const code = useClaimCode(claim.id, true);
  const claims = useClaims(claim.clubId);
  const live = claims.data?.claims.find((entry) => entry.id === claim.id) ?? claim;
  const left = useSecondsLeft(live.expiresAt, live.status === 'open');
  const url =
    code.data && typeof window !== 'undefined'
      ? `${window.location.origin}/dashboard/claim?c=${code.data.code}`
      : null;
  const name = text.name(claim.key, claim.custom);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName="backdrop-blur-md"
        className="max-w-xl justify-items-center gap-5 text-center"
      >
        <DialogHeader className="items-center pe-0">
          <DialogTitle>{claim.title}</DialogTitle>
          <DialogDescription>{t('screen.hint', { name })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4">
          <Sticker stickerKey={claim.key} custom={claim.custom} size={72} />
          <div className="grid gap-1 text-start">
            <b className="text-lg">{name}</b>
            <span className="font-mono text-2xl" dir="ltr">
              {live.claimed} / {live.maxClaims}
            </span>
          </div>
        </div>
        <div
          className="grid size-[19rem] max-w-full place-items-center rounded-card p-5 shadow-lg"
          style={{ background: 'var(--badge-white)' }}
        >
          {live.status === 'open' && url ? (
            <PassQr value={url} label={t('screen.qr')} color="var(--badge-ink)" />
          ) : (
            <p className="m-0 text-base font-semibold" style={{ color: 'var(--badge-ink)' }}>
              {t(`status.${live.status}`)}
            </p>
          )}
        </div>
        <p className="m-0 text-sm text-fg-muted">
          {live.status === 'open' ? t('screen.changes') : t('screen.ended')}
          {live.status === 'open' ? (
            <>
              {' · '}
              {t('screen.left', {
                minutes: Math.floor(left / 60),
                seconds: String(left % 60).padStart(2, '0'),
              })}
            </>
          ) : null}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «رموز الاستلام»: a leader picks a sticker, a number and a time, and shows the code on the screen
 * at the event. Whoever scans it while it is open gets the sticker once (docs/adr/0034). A lead
 * makes codes for a committee they lead; officers for the whole club or one committee.
 */
export function ClaimsPanel({
  clubId,
  stickers,
}: {
  clubId: string;
  stickers: readonly StudioSticker[];
}) {
  const t = useTranslations('wallet.claims');
  const text = useStickerText();
  const me = useMe();
  const claims = useClaims(clubId);
  const { create, close } = useClaimActions(clubId);
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<StickerClaim | null>(null);

  const [key, setKey] = useState<StickerRef>('star');
  const [title, setTitle] = useState('');
  const [maxClaims, setMaxClaims] = useState('40');
  const [minutes, setMinutes] = useState<number>(120);
  const [committeeId, setCommitteeId] = useState('');

  const isOfficer = Boolean(
    me.data?.user.isFullAdmin ||
    me.data?.access.clubs.some((club) => club.id === clubId && club.canManage),
  );
  // An officer may pick any committee of the club or none; a lead only one they lead.
  const committees = useMemo(() => {
    if (!me.data) return [];
    const inClub = me.data.access.committees.filter((committee) => committee.clubId === clubId);
    if (isOfficer) return inClub;
    const led = new Set(
      me.data.memberships
        .filter((membership) => membership.club.id === clubId)
        .flatMap((membership) =>
          membership.committees.filter((c) => c.role === 'LEAD').map((c) => c.id),
        ),
    );
    return inClub.filter((committee) => led.has(committee.id));
  }, [me.data, clubId, isOfficer]);

  const options: StickerRef[] = [
    ...AWARDABLE_STICKER_KEYS,
    ...stickers
      .filter((sticker) => !sticker.archived)
      .filter((sticker) => isOfficer || sticker.awardableBy === 'LEAD')
      .map((sticker) => customStickerKey(sticker.id)),
  ];
  const definitions = new Map(stickers.map((sticker) => [sticker.key as string, sticker]));
  const nameOf = (ref: StickerRef) => text.name(ref, definitions.get(ref) ?? null);

  const count = Number(maxClaims);
  const countOk = Number.isInteger(count) && count >= 1 && count <= CLAIM_LIMITS.maxClaims;
  const committeeOk = isOfficer || committeeId !== '';
  const ready = title.trim() !== '' && countOk && committeeOk;

  const submit = () => {
    const body: CreateClaimBody = {
      key: key as CreateClaimBody['key'],
      title: title.trim(),
      maxClaims: count,
      minutes,
      committeeId: committeeId === '' ? null : committeeId,
    };
    create.mutate(body, {
      onSuccess: (made) => {
        setCreating(false);
        setTitle('');
        setShowing(made);
      },
    });
  };

  return (
    <section aria-labelledby="claims-title" className="grid gap-4 border-t border-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="claims-title" className="m-0 flex items-center gap-2 text-base font-semibold">
            <QrCode aria-hidden className="size-4 text-primary" />
            {t('title')}
          </h2>
          <p className="m-0 max-w-2xl text-sm text-fg-muted">{t('subtitle')}</p>
        </div>
        {creating ? null : (
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>

      {creating ? (
        <form
          aria-label={t('new')}
          className="grid gap-4 rounded-card border border-border bg-surface-1 p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.sticker')}
            <select
              value={key}
              onChange={(event) => setKey(event.target.value as StickerRef)}
              className="h-11 rounded-md border border-input bg-surface-1 px-3 text-sm font-normal text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {nameOf(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.title')}
            <Input
              value={title}
              maxLength={60}
              placeholder={t('placeholders.title')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.maxClaims')}
            <Input
              type="number"
              dir="ltr"
              min={1}
              max={CLAIM_LIMITS.maxClaims}
              value={maxClaims}
              aria-invalid={!countOk}
              onChange={(event) => setMaxClaims(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t('fields.minutes')}
            <select
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              className="h-11 rounded-md border border-input bg-surface-1 px-3 text-sm font-normal text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {DURATIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`durations.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">
            {t('fields.committee')}
            <select
              value={committeeId}
              onChange={(event) => setCommitteeId(event.target.value)}
              className="h-11 rounded-md border border-input bg-surface-1 px-3 text-sm font-normal text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {isOfficer ? <option value="">{t('allClub')}</option> : <option value="">—</option>}
              {committees.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-fg-muted">
              {isOfficer ? t('hints.committeeOfficer') : t('hints.committeeLead')}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={create.isPending} disabled={!ready}>
              {t('create')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            {create.isError ? (
              <p role="alert" className="m-0 text-sm text-danger">
                {t('failed')}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {claims.isPending ? (
        <Skeleton className="h-24" />
      ) : (claims.data?.claims.length ?? 0) === 0 ? (
        <p className="m-0 rounded-card border border-dashed border-border p-5 text-sm text-fg-muted">
          {t('empty')}
        </p>
      ) : (
        <ul aria-label={t('listLabel')} className="m-0 grid list-none gap-3 p-0">
          {claims.data?.claims.map((claim) => (
            <li
              key={claim.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-card border border-border bg-surface-1 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
              <Sticker stickerKey={claim.key} custom={claim.custom} size={52} />
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm">{claim.title}</b>
                  <Badge variant={claim.status === 'open' ? 'success' : 'neutral'}>
                    {t(`status.${claim.status}`)}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, (claim.claimed / claim.maxClaims) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-xs text-fg-muted" dir="ltr">
                    {claim.claimed} / {claim.maxClaims}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1">
                {claim.status === 'open' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setShowing(claim)}>
                      <Maximize2 aria-hidden />
                      {t('show')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={close.isPending && close.variables === claim.id}
                      onClick={() => close.mutate(claim.id)}
                    >
                      <Square aria-hidden className={cn('size-3.5')} />
                      {t('stop')}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showing ? <ClaimScreen claim={showing} onClose={() => setShowing(null)} /> : null}
    </section>
  );
}
