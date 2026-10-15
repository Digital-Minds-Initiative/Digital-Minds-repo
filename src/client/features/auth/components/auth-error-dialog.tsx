'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type AuthErrorKind = 'invalid_code' | 'code_expired' | 'too_many_attempts' | 'rate_limited';

export interface AuthErrorDialogProps {
  kind: AuthErrorKind | null;
  retryAfterSeconds?: number;
  onOpenChange: (open: boolean) => void;
  onAction: () => void;
}

export function AuthErrorDialog({
  kind,
  retryAfterSeconds,
  onOpenChange,
  onAction,
}: AuthErrorDialogProps) {
  const t = useTranslations('auth.errors');

  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-paper-rule bg-paper-cream text-on-paper dark:border-on-deep/25 dark:bg-slab-2 dark:text-on-deep">
        {kind ? (
          <>
            <CircleAlert
              className="absolute start-6 top-6 size-8 rounded-full bg-danger-subtle p-1.5 text-danger"
              aria-hidden
            />
            <DialogTitle className="pt-10 text-center font-serif text-2xl font-semibold">
              {t(`${kind}.title`)}
            </DialogTitle>
            <DialogDescription className="text-center text-on-paper-muted dark:text-on-deep-muted">
              {kind === 'rate_limited'
                ? t('rate_limited.body', { seconds: retryAfterSeconds ?? 0 })
                : t(`${kind}.body`)}
            </DialogDescription>
            <Button
              className="mt-2 w-full bg-teal text-on-teal hover:bg-teal/90 dark:bg-brand dark:text-on-brand dark:hover:bg-brand/90"
              onClick={onAction}
            >
              {t(`${kind}.action`)}
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
