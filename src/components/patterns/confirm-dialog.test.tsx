// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/client/lib/api-client';
import { renderWithProviders } from '@tests/utils/render';

import { ConfirmDialog } from './confirm-dialog';

function setup(onConfirm: () => Promise<void>) {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  renderWithProviders(
    <ConfirmDialog open onOpenChange={onOpenChange} title="إلغاء العملية؟" onConfirm={onConfirm} />,
  );
  return { onOpenChange };
}

describe('ConfirmDialog', () => {
  it('closes when the action succeeds', async () => {
    const { onOpenChange } = setup(async () => {});
    await userEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open and shows the translated error when the action fails', async () => {
    const { onOpenChange } = setup(async () => {
      throw new ApiError(409, 'CONFLICT', 'The transaction is already cancelled.');
    });
    await userEvent.click(screen.getByRole('button', { name: 'تأكيد' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعارض مع بيانات تغيّرت للتو. حدّث الصفحة ثم حاول مرة أخرى.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
