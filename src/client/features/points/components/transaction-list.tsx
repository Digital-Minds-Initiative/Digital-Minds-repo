'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { toast } from '@/components/ui/toaster';
import type { PointTransaction } from '@/shared/contracts/points';

import { CancelPointsDialog } from './cancel-points-dialog';
import { PointsFormDialog } from './points-form-dialog';
import { TransactionRow } from './transaction-row';
import { useCancelPoints, useEditPoints } from '../hooks/use-points';

interface TransactionListProps {
  transactions: readonly PointTransaction[];
  label: string;
  /** Whether the person may edit and cancel this transaction (see `canWritePoints`). */
  canWrite: (transaction: PointTransaction) => boolean;
  /** Names the member on each row, for lists that mix members. */
  memberLabel?: (transaction: PointTransaction) => string;
}

/**
 * A list of ledger entries together with what editing and cancelling one needs: the correction
 * form, the cancellation dialog (with its required reason) and the confirmation messages. Used by
 * a member's own ledger and by the committee-wide ledger.
 */
export function TransactionList({
  transactions,
  label,
  canWrite,
  memberLabel,
}: TransactionListProps) {
  const tForm = useTranslations('points.form');
  const edit = useEditPoints();
  const cancel = useCancelPoints();
  const [editing, setEditing] = useState<PointTransaction | null>(null);
  const [cancelling, setCancelling] = useState<PointTransaction | null>(null);

  return (
    <>
      <ul aria-label={label} className="m-0 grid list-none gap-2 p-0">
        {transactions.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            canWrite={canWrite(transaction)}
            memberLabel={memberLabel?.(transaction)}
            onEdit={setEditing}
            onCancel={setCancelling}
          />
        ))}
      </ul>
      {editing ? (
        <PointsFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          mode={{
            type: 'edit',
            transaction: editing,
            onSubmit: async (body) => {
              await edit.mutateAsync({ transactionId: editing.id, body });
              toast.success(tForm('toasts.edited'));
            },
          }}
        />
      ) : null}
      <CancelPointsDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await cancel.mutateAsync({ transactionId: cancelling.id, body: { reason } });
          toast.success(tForm('toasts.cancelled'));
        }}
      />
    </>
  );
}
