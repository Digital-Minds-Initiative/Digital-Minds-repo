// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PointsSystem } from '../points-system';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

const props = {
  ledger: {
    sectionLabel: 'POINTS',
    title: 'نقاط',
    rows: [
      { id: 'a', date: '2026-10-02', reason: 'حضور', points: 20 },
      { id: 'b', date: '2026-09-28', reason: 'تغطية', points: 35 },
      { id: 'c', date: '2026-09-25', reason: 'مكرر', points: 20, voided: true },
    ],
    labels: { balance: 'BALANCE', date: 'تاريخ', reason: 'سبب', points: 'نقاط', cancelled: 'VOID' },
  },
  board: {
    sectionLabel: 'LEADERBOARD',
    title: 'مين الأعلى؟',
    panelLabel: 'TOP',
    entries: [
      { id: 'm1', label: 'MEMBER 01', points: 60 },
      { id: 'm2', label: 'MEMBER 02', linked: true },
      { id: 'm3', label: 'MEMBER 03', points: 40 },
    ],
  },
};

const rankOf = (label: string) => screen.getByText(label).previousElementSibling?.textContent;

describe('PointsSystem', () => {
  it('re-ranks the leaderboard when a ledger entry is cancelled and restored', async () => {
    const user = userEvent.setup();
    render(<PointsSystem {...props} />);
    // 55 points: second place.
    await waitFor(() => expect(screen.getByTestId('score-m2').textContent).toBe('55'));
    expect(rankOf('MEMBER 02')).toBe('2');

    await user.click(screen.getByRole('button', { name: /مكرر/ }));
    await waitFor(() => expect(screen.getByTestId('score-m2').textContent).toBe('75'));
    expect(rankOf('MEMBER 02')).toBe('1');

    await user.click(screen.getByRole('button', { name: /تغطية/ }));
    await user.click(screen.getByRole('button', { name: /حضور/ }));
    await waitFor(() => expect(screen.getByTestId('score-m2').textContent).toBe('20'));
    expect(rankOf('MEMBER 02')).toBe('3');
  });
});
