'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
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
import { Label } from '@/components/ui/label';

export interface TypedConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** More to read before confirming — what goes and what stays. */
  children?: ReactNode;
  /** What the person must type. The button stays disabled until the input matches it. */
  expected: string;
  /** Applied to both sides before comparing; trims and collapses spaces by default. */
  normalize?: (value: string) => string;
  /** Says what to type, e.g. «اكتب اسم اللجنة للتأكيد». */
  inputLabel: string;
  /** `ltr` for an email address. */
  inputDir?: 'ltr' | 'rtl';
  confirmLabel: string;
  /**
   * Receives what was typed, which the request should carry so the server compares it too. The
   * button shows a spinner until it settles; if it rejects, the error is shown and the dialog stays.
   */
  onConfirm: (typed: string) => Promise<void>;
}

const collapseSpaces = (value: string) => value.trim().replace(/\s+/g, ' ');

/**
 * Asks before an action that cannot be undone, by making the person type something only they
 * would type on purpose — the committee's name, the person's email. The server compares it again;
 * this only keeps the button closed until the two match.
 */
export function TypedConfirmDialog(props: TypedConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onOpenChange(false);
      }}
    >
      {/* Mounted only while open, so what was typed never carries over to the next time. */}
      {props.open ? <TypedConfirmContent {...props} /> : null}
    </Dialog>
  );
}

function TypedConfirmContent({
  onOpenChange,
  title,
  description,
  children,
  expected,
  normalize = collapseSpaces,
  inputLabel,
  inputDir,
  confirmLabel,
  onConfirm,
}: TypedConfirmDialogProps) {
  const t = useTranslations('ui.confirmDialog');
  const tValidation = useTranslations('common.validation');
  const errorText = useErrorText();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = normalize(typed) === normalize(expected);

  /** A refused confirmation is a field issue; say which rather than "check the data". */
  function describe(caught: unknown): string {
    const code = caught instanceof ApiError ? caught.details.issues?.[0]?.code : undefined;
    const key = `${code}` as Parameters<typeof tValidation>[0];
    return code && tValidation.has(key) ? tValidation(key) : errorText(caught);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(typed);
      onOpenChange(false);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>

      {children}

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !pending) void confirm();
        }}
      >
        <Label htmlFor={inputId}>{inputLabel}</Label>
        <Input
          id={inputId}
          value={typed}
          dir={inputDir}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
          {t('cancel')}
        </Button>
        <Button
          variant="danger"
          loading={pending}
          disabled={!matches}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
