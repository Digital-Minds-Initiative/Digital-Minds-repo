// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/client/lib/api-client';
import { renderWithProviders } from '@tests/utils/render';

import { TypedConfirmDialog } from './typed-confirm-dialog';

function setup(onConfirm: (typed: string) => Promise<void>) {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  renderWithProviders(
    <TypedConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="حذف «لجنة التقنية» نهائياً؟"
      expected="لجنة التقنية"
      inputLabel="اكتب اسم اللجنة للتأكيد"
      confirmLabel="حذف نهائياً"
      onConfirm={onConfirm}
    />,
  );
  return {
    onOpenChange,
    input: screen.getByLabelText('اكتب اسم اللجنة للتأكيد'),
    button: screen.getByRole('button', { name: 'حذف نهائياً' }),
  };
}

describe('TypedConfirmDialog', () => {
  it('opens the button only for the exact text, and sends what was typed', async () => {
    const onConfirm = vi.fn(async () => {});
    const { input, button, onOpenChange } = setup(onConfirm);

    expect(button).toHaveProperty('disabled', true);
    await userEvent.type(input, 'لجنة');
    expect(button).toHaveProperty('disabled', true);
    await userEvent.type(input, ' التقنية ');
    expect(button).toHaveProperty('disabled', false);

    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith('لجنة التقنية ');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open and names a refused confirmation', async () => {
    const { input, button, onOpenChange } = setup(async () => {
      throw new ApiError(422, 'VALIDATION_FAILED', 'invalid', {
        issues: [{ path: ['body', 'name'], code: 'confirmation_mismatch', message: 'x' }],
      });
    });
    await userEvent.type(input, 'لجنة التقنية');
    await userEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'النص المكتوب لا يطابق المطلوب تماماً.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
