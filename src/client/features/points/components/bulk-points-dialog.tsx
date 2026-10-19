'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { FormField } from '@/components/patterns/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import {
  CLUB_POINTS_BULK_MAX,
  COMMITTEE_POINTS_BULK_MAX,
  POINTS_REASON_MAX,
  workDateSchema,
  type PointsBulkResult,
} from '@/shared/contracts/points';
import { todayInAppTimeZone } from '@/shared/lib/dates';
import { collapseWhitespace } from '@/shared/lib/text';

import { amountFieldSchema } from './points-form-dialog';

interface BulkMember {
  id: string;
  fullName: string;
}

export interface BulkGroup {
  committee: { id: string; name: string };
  members: readonly BulkMember[];
}

export interface BulkPointsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `committee`: one committee, a list of members. `club`: pairs across the club's committees. */
  kind: 'committee' | 'club';
  /** The committee's or the club's name, for the title. */
  name: string;
  groups: readonly BulkGroup[];
  /** Sends the batch; resolves with what the server wrote. */
  onSubmit: (request: {
    batchId: string;
    amount: number;
    reason: string;
    workDate: string;
    pairs: ReadonlyArray<{ memberId: string; committeeId: string }>;
  }) => Promise<PointsBulkResult>;
}

const schema = z.object({
  kind: z.enum(['add', 'deduct']),
  amount: amountFieldSchema,
  reason: z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().min(1, { message: 'invalid_type' }).max(POINTS_REASON_MAX)),
  workDate: workDateSchema,
});

const keyOf = (committeeId: string, memberId: string) => `${committeeId}:${memberId}`;

/**
 * Giving several members the same points at once — attendance, mostly (ADR 0022). Everyone ticked
 * gets their own transaction; if the server cannot give points to one of them it writes nothing
 * and names who (422 `entries_rejected`), so those are unticked, said so, and the rest can be
 * sent again.
 *
 * The batch id is what makes a double tap or a retry after a lost response safe: it stays the same
 * while the request is the same, and changes as soon as anything in it does.
 */
export function BulkPointsDialog(props: BulkPointsDialogProps) {
  // Mounted only while open, so every opening starts with nothing ticked.
  return props.open ? <BulkForm {...props} /> : null;
}

function BulkForm({ onOpenChange, kind, name, groups, onSubmit }: BulkPointsDialogProps) {
  const t = useTranslations('points.bulk');
  const tForm = useTranslations('points.form');
  const errorText = useErrorText();
  const today = useMemo(() => todayInAppTimeZone(), []);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rejected, setRejected] = useState<ReadonlyMap<string, string>>(new Map());
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [batch, setBatch] = useState<{ id: string; fingerprint: string } | null>(null);

  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { kind: 'add', amount: '', reason: '', workDate: today },
  });

  const max = kind === 'committee' ? COMMITTEE_POINTS_BULK_MAX : CLUB_POINTS_BULK_MAX;
  const needle = search.trim();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => !needle || member.fullName.includes(needle)),
    }))
    .filter((group) => group.members.length > 0);
  const total = groups.reduce((sum, group) => sum + group.members.length, 0);

  /** The ticked pairs in the order the lists show them: the request's order, and the 422's index. */
  const pairs = groups.flatMap((group) =>
    group.members
      .filter((member) => selected.has(keyOf(group.committee.id, member.id)))
      .map((member) => ({ memberId: member.id, committeeId: group.committee.id })),
  );
  const inSeveral = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pair of pairs) counts.set(pair.memberId, (counts.get(pair.memberId) ?? 0) + 1);
    return [...counts.values()].filter((count) => count > 1).length;
  }, [pairs]);

  function toggle(keys: readonly string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    setFormError(null);
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (pairs.length === 0) {
      setFormError(t('noneSelected'));
      return;
    }
    if (pairs.length > max) {
      setFormError(t('tooMany', { max }));
      return;
    }
    const magnitude = Number(values.amount);
    const amount = values.kind === 'deduct' ? -magnitude : magnitude;
    // One key per distinct request: a resend of the same one reuses it, a changed one gets its own.
    const fingerprint = JSON.stringify([pairs, amount, values.reason, values.workDate]);
    const batchId = batch?.fingerprint === fingerprint ? batch.id : crypto.randomUUID();
    setBatch({ id: batchId, fingerprint });
    try {
      const result = await onSubmit({
        batchId,
        amount,
        reason: values.reason,
        workDate: values.workDate,
        pairs,
      });
      toast.success(t('done', { count: result.count }));
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 422 &&
        error.details.reason === 'entries_rejected'
      ) {
        // The issue paths index the list that was sent: ['body', 'entries' | 'memberIds', index, …].
        const bad = new Map<string, string>();
        for (const issue of error.details.issues ?? []) {
          const index = issue.path.find((part) => typeof part === 'number');
          const pair = typeof index === 'number' ? pairs[index] : undefined;
          if (pair) bad.set(keyOf(pair.committeeId, pair.memberId), issue.code);
        }
        if (bad.size > 0) {
          setRejected((current) => new Map([...current, ...bad]));
          toggle([...bad.keys()], false);
          setFormError(t('rejectedSummary', { count: bad.size }));
          return;
        }
      }
      setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    // A double tap arrives before the button shows as busy; the batch id would catch it on the
    // server, but one request is simpler for everyone.
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    void submit(event).finally(() => {
      busyRef.current = false;
    });
  }

  const visibleKeys = visibleGroups.flatMap((group) =>
    group.members.map((member) => keyOf(group.committee.id, member.id)),
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!form.formState.isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === 'committee'
              ? t('committeeTitle', { committee: name })
              : t('clubTitle', { club: name })}
          </DialogTitle>
          <DialogDescription>
            {kind === 'committee' ? t('committeeDescription') : t('clubDescription')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="kind"
            label={tForm('kind')}
            render={({ field }) => (
              <div role="group" aria-label={tForm('kind')} className="grid grid-cols-2 gap-2">
                {(['add', 'deduct'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={field.value === option}
                    onClick={() => field.onChange(option)}
                    className={cn(
                      'h-11 cursor-pointer rounded-md border text-sm font-semibold transition-colors',
                      'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                      field.value === option
                        ? option === 'add'
                          ? 'border-success bg-success-subtle text-success-subtle-fg'
                          : 'border-danger bg-danger-subtle text-danger-subtle-fg'
                        : 'border-border-strong bg-transparent text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    {tForm(`kinds.${option}`)}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="amount"
              label={tForm('fields.amount')}
              description={tForm('fields.amountHint')}
              required
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                  autoFocus
                />
              )}
            />
            <FormField
              control={form.control}
              name="workDate"
              label={tForm('fields.workDate')}
              description={tForm('fields.workDateHint')}
              required
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} type="date" max={today} dir="ltr" />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="reason"
            label={tForm('fields.reason')}
            description={tForm('fields.reasonHint')}
            required
            render={({ field, controlProps }) => (
              <textarea
                {...field}
                {...controlProps}
                rows={2}
                maxLength={POINTS_REASON_MAX * 2}
                className="min-h-16 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-fg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-danger"
              />
            )}
          />

          <section aria-label={t('members')} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('members')}</h3>
              <span className="text-sm text-fg-muted" aria-live="polite">
                {t('selectedCount', { selected: pairs.length, total })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={visibleKeys.length === 0}
                onClick={() => toggle(visibleKeys, true)}
              >
                {t('selectVisible')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pairs.length === 0}
                onClick={() => toggle([...selected], false)}
              >
                {t('clearAll')}
              </Button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-1">
              {total === 0 ? (
                <p className="p-4 text-sm text-fg-muted">{t('empty')}</p>
              ) : visibleGroups.length === 0 ? (
                <p className="p-4 text-sm text-fg-muted">{t('noMatches')}</p>
              ) : (
                visibleGroups.map((group) => {
                  const keys = group.members.map((member) => keyOf(group.committee.id, member.id));
                  const ticked = keys.filter((key) => selected.has(key)).length;
                  return (
                    <div key={group.committee.id} role="group" aria-label={group.committee.name}>
                      {kind === 'club' ? (
                        <label className="sticky top-0 flex cursor-pointer items-center gap-2 border-b border-border bg-surface-3 px-3 py-2 text-sm font-semibold">
                          <Checkbox
                            checked={
                              ticked === 0 ? false : ticked === keys.length ? true : 'indeterminate'
                            }
                            onCheckedChange={(checked) => toggle(keys, checked === true)}
                            aria-label={t('selectGroup', { committee: group.committee.name })}
                          />
                          {group.committee.name}
                        </label>
                      ) : null}
                      <ul className="m-0 list-none p-0">
                        {group.members.map((member) => {
                          const key = keyOf(group.committee.id, member.id);
                          const refusal = rejected.get(key);
                          return (
                            <li key={key}>
                              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
                                <Checkbox
                                  checked={selected.has(key)}
                                  onCheckedChange={(checked) => toggle([key], checked === true)}
                                  aria-label={
                                    kind === 'club'
                                      ? `${member.fullName} · ${group.committee.name}`
                                      : member.fullName
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">{member.fullName}</span>
                                {refusal ? (
                                  <Badge variant="danger">
                                    {t(
                                      `rejected.${
                                        [
                                          'not_found',
                                          'member_removed',
                                          'not_in_committee',
                                          'committee_not_in_club',
                                          'committee_archived',
                                        ].includes(refusal)
                                          ? (refusal as 'not_found')
                                          : 'other'
                                      }`,
                                    )}
                                  </Badge>
                                ) : null}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
            {inSeveral > 0 ? (
              <p
                role="note"
                className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg"
              >
                {t('inSeveralCommittees', { count: inSeveral })}
              </p>
            ) : null}
          </section>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tForm('cancel')}
            </Button>
            <Button
              type="submit"
              loading={form.formState.isSubmitting}
              disabled={pairs.length === 0}
            >
              {t('submit', { count: pairs.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
