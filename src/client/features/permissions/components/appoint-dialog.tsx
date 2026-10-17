'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Member } from '@/shared/contracts/members';

import { useCandidates } from '../hooks/use-permissions';

const SEARCH_DEBOUNCE_MS = 250;

export interface AppointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  clubId: string;
  /** Restricts the choice to members of this committee (appointing a lead). */
  committeeId?: string;
  /** Whether the member already holds the role being given, so it is shown but not selectable. */
  holdsRole: (member: Member) => boolean;
  onSubmit: (member: Member) => Promise<unknown>;
}

/**
 * Picks the member who gets a role: search by name or email, choose one of the matches, confirm.
 * Only members who can receive it are offered — active members of the club, or of the committee —
 * and one who already holds the role is shown as such, because granting it again would change
 * nothing.
 */
export function AppointDialog(props: AppointDialogProps) {
  // Mounted only while open, so every opening starts with an empty search and no choice.
  return props.open ? <AppointForm {...props} /> : null;
}

function AppointForm({
  onOpenChange,
  title,
  description,
  clubId,
  committeeId,
  holdsRole,
  onSubmit,
}: AppointDialogProps) {
  const t = useTranslations('permissions.appoint');
  const errorText = useErrorText();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Member | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useCandidates(clubId, committeeId, q);

  // Search once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  async function submit() {
    if (!chosen || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(chosen);
      onOpenChange(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  const items = candidates.data?.items ?? [];
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative">
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
            autoFocus
          />
        </div>

        <div
          role="group"
          aria-label={t('results')}
          className="grid max-h-64 gap-1.5 overflow-y-auto"
        >
          {candidates.isPending ? (
            <p className="px-1 text-sm text-fg-muted" aria-busy>
              …
            </p>
          ) : items.length === 0 ? (
            <p className="px-1 text-sm text-fg-muted">{t('none')}</p>
          ) : (
            items.map((member) => {
              const holds = holdsRole(member);
              const picked = chosen?.id === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  disabled={holds}
                  aria-pressed={picked}
                  onClick={() => setChosen(member)}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-start text-sm transition-colors',
                    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                    'disabled:cursor-not-allowed disabled:opacity-55',
                    picked
                      ? 'border-primary bg-primary-subtle text-primary-subtle-fg'
                      : 'border-border bg-surface-1 hover:bg-surface-3',
                  )}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{member.user.fullName}</span>
                    <bdi dir="ltr" className="truncate text-xs text-fg-muted">
                      {member.user.uniEmail}
                    </bdi>
                  </span>
                  {holds ? <Badge variant="neutral">{t('alreadyHolds')}</Badge> : null}
                </button>
              );
            })
          )}
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button loading={pending} disabled={!chosen} onClick={() => void submit()}>
            {chosen ? `${t('submit')} ${chosen.user.fullName}` : t('pick')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
