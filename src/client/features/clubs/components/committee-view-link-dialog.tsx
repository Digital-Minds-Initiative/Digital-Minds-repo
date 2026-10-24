'use client';

import { Check, Copy, Info, Link2, Link2Off, RefreshCw, RotateCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useErrorText } from '@/client/lib/use-error-text';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
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
import { toast } from '@/components/ui/toaster';
import type { Committee } from '@/shared/contracts/clubs';

import {
  useCommitteeViewLink,
  useDisableCommitteeViewLink,
  useRotateCommitteeViewLink,
} from '../hooks/use-clubs';

/** How long the copy button says «نُسخ» before it goes back to «نسخ». */
const COPIED_MS = 2000;

interface CommitteeViewLinkDialogProps {
  committee: Committee;
  /** The committee or its club is archived: the server refuses every write, so none is offered. */
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The committee's view-only link (docs/adr/0023-committee-view-link.md): create it, copy it,
 * renew it, turn it off. Whoever can see the committee here — its lead, the club's officers, full
 * admins — may do all four. The link shown is the server's `url`, never one built from the token.
 */
export function CommitteeViewLinkDialog({
  committee,
  readOnly,
  open,
  onOpenChange,
}: CommitteeViewLinkDialogProps) {
  const t = useTranslations('clubs.viewLink');
  const format = useFormatter();
  const errorText = useErrorText();
  const link = useCommitteeViewLink(committee.id, open);
  const rotate = useRotateCommitteeViewLink(committee.id);
  const disable = useDisableCommitteeViewLink(committee.id);
  const [confirming, setConfirming] = useState<'renew' | 'disable' | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const url = link.data?.url ?? null;
  const createdAt = link.data?.createdAt ?? null;

  function copy(value: string) {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast.success(t('copiedToast'));
      })
      .catch(() => toast.error(t('copyFailed')));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: committee.name })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {link.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : link.isError ? (
          <div className="grid justify-items-start gap-3">
            <p className="text-sm text-danger">{t('loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void link.refetch()}>
              <RotateCw aria-hidden />
              {t('retry')}
            </Button>
          </div>
        ) : url === null ? (
          <div className="grid justify-items-start gap-3">
            <p className="text-sm text-fg-muted">{t('none')}</p>
            {readOnly ? null : (
              <Button
                loading={rotate.isPending}
                onClick={() =>
                  rotate
                    .mutateAsync()
                    .then(() => toast.success(t('toasts.created')))
                    .catch((error: unknown) => toast.error(errorText(error)))
                }
              >
                <Link2 aria-hidden />
                {t('create')}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <label htmlFor={`view-link-${committee.id}`} className="text-sm font-medium">
              {t('urlLabel')}
            </label>
            <div className="flex gap-2">
              <Input
                id={`view-link-${committee.id}`}
                value={url}
                readOnly
                dir="ltr"
                className="min-w-0 flex-1 font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
              {readOnly ? null : (
                <Button variant="outline" onClick={() => copy(url)}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t('copied') : t('copy')}
                </Button>
              )}
            </div>
            {createdAt ? (
              <p className="text-xs text-fg-muted">
                {t('createdAgo', { ago: format.relativeTime(new Date(createdAt), new Date()) })}
              </p>
            ) : null}
            {readOnly ? null : (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button variant="outline" size="sm" onClick={() => setConfirming('renew')}>
                  <RefreshCw aria-hidden />
                  {t('renew')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => setConfirming('disable')}
                >
                  <Link2Off aria-hidden />
                  {t('disable')}
                </Button>
              </div>
            )}
          </div>
        )}

        {readOnly ? (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md bg-surface-3 px-3 py-2 text-xs text-fg-muted"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('archivedNote')}
          </p>
        ) : null}

        <ConfirmDialog
          open={confirming === 'renew'}
          onOpenChange={(next) => setConfirming(next ? 'renew' : null)}
          variant="danger"
          title={t('renewConfirm.title')}
          description={t('renewConfirm.body')}
          confirmLabel={t('renewConfirm.confirm')}
          onConfirm={async () => {
            await rotate.mutateAsync();
            setCopied(false);
            toast.success(t('toasts.renewed'));
          }}
        />
        <ConfirmDialog
          open={confirming === 'disable'}
          onOpenChange={(next) => setConfirming(next ? 'disable' : null)}
          variant="danger"
          title={t('disableConfirm.title')}
          description={t('disableConfirm.body')}
          confirmLabel={t('disableConfirm.confirm')}
          onConfirm={async () => {
            await disable.mutateAsync();
            toast.success(t('toasts.disabled'));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
