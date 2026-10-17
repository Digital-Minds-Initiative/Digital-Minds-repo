'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MembershipType } from '@/shared/contracts/clubs';

export interface DeleteTypeDialogProps {
  type: MembershipType | null;
  /** Every type of the club, this one included. */
  types: readonly MembershipType[];
  onOpenChange: (open: boolean) => void;
  /** `moveMembersTo` is set when the type is in use. */
  onConfirm: (moveMembersTo: string | undefined) => Promise<unknown>;
}

/**
 * Deleting a type has three cases, decided by what the list says about it: the club's last type
 * cannot go; a type nobody holds just goes; a type in use (removed members count too) first asks
 * where its members should move to.
 */
export function DeleteTypeDialog(props: DeleteTypeDialogProps) {
  // Mounted only for the type being deleted, so the chosen target never leaks to the next one.
  return props.type ? <DeleteTypeForm {...props} type={props.type} /> : null;
}

function DeleteTypeForm({
  type,
  types,
  onOpenChange,
  onConfirm,
}: DeleteTypeDialogProps & { type: MembershipType }) {
  const t = useTranslations('clubs.types.delete');
  const tForm = useTranslations('clubs.form');
  const errorText = useErrorText();
  const [target, setTarget] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = types.filter((candidate) => candidate.id !== type.id);
  const isLast = others.length === 0;
  const needsTarget = type.inUse;

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(needsTarget ? target : undefined);
      onOpenChange(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: type.name })}</DialogTitle>
          <DialogDescription>
            {isLast
              ? t('last')
              : needsTarget
                ? t('inUse', { active: type.activeMemberCount })
                : t('plain')}
          </DialogDescription>
        </DialogHeader>

        {!isLast && needsTarget ? (
          <div className="grid gap-2">
            <Label id="move-target-label">{t('moveTo')}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger aria-labelledby="move-target-label">
                <SelectValue placeholder={t('movePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {others.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {other.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {tForm('cancel')}
          </Button>
          {isLast ? null : (
            <Button
              variant="danger"
              loading={pending}
              disabled={needsTarget && target === ''}
              onClick={() => void confirm()}
            >
              {t('confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
