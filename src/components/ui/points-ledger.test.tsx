// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PointsLedger, type PointsLedgerProps } from './points-ledger';

const props: PointsLedgerProps = {
  rows: [
    { id: 'a', date: '2026-10-02', reason: 'حضور ورشة', points: 20 },
    { id: 'b', date: '2026-09-28', reason: 'تغطية', points: 35 },
    { id: 'c', date: '2026-09-25', reason: 'إدخال مكرر', points: 20, voided: true },
    { id: 'd', date: '2026-09-20', reason: 'تأخر', points: -10 },
  ],
  labels: {
    balance: 'BALANCE',
    date: 'التاريخ',
    reason: 'السبب',
    points: 'النقاط',
    cancelled: 'VOID',
  },
};

beforeEach(() => {
  // Reduced motion: the balance jumps to its value instead of counting.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

describe('PointsLedger', () => {
  it('starts with the cancelled row out of the balance', async () => {
    render(<PointsLedger {...props} />);
    await waitFor(() => expect(screen.getByTestId('ledger-balance').textContent).toBe('45'));
    expect(screen.getByRole('button', { name: /إدخال مكرر/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('cancels a row without deleting it, then restores it', async () => {
    const user = userEvent.setup();
    render(<PointsLedger {...props} />);

    await user.click(screen.getByRole('button', { name: /تغطية/ }));
    await waitFor(() => expect(screen.getByTestId('ledger-balance').textContent).toBe('10'));
    const row = screen.getByRole('button', { name: /تغطية/ });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.textContent).toContain('VOID');

    await user.click(row);
    await waitFor(() => expect(screen.getByTestId('ledger-balance').textContent).toBe('45'));
    expect(screen.getByRole('button', { name: /تغطية/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('puts a restored cancelled row back into the balance', async () => {
    const user = userEvent.setup();
    render(<PointsLedger {...props} />);
    await user.click(screen.getByRole('button', { name: /إدخال مكرر/ }));
    await waitFor(() => expect(screen.getByTestId('ledger-balance').textContent).toBe('65'));
  });
});
