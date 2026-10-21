// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TicTacToeNote, type TicTacToeLabels } from '../tic-tac-toe-note';

const labels: TicTacToeLabels = {
  heading: { turn: 'دورك', win: 'فزت', lose: 'خسرت', draw: 'تعادل' },
  status: { yourTurn: 'دورك', thinking: 'يفكر', win: 'فزت', lose: 'خسرت', draw: 'تعادل' },
  play: 'العب بـ',
  restart: 'إعادة',
  cell: 'الخانة {n}',
  empty: 'فارغة',
};

const cell = (n: number) => screen.getByRole('button', { name: new RegExp(`^الخانة ${n}،`) });

describe('TicTacToeNote — arrow keys', () => {
  it('moves one cell in the pressed direction and stops at the edges', async () => {
    const user = userEvent.setup();
    render(<TicTacToeNote labels={labels} />);
    cell(1).focus();

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell(2));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell(3));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell(3));

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(6));
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(9));

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cell(8));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cell(5));
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(cell(4));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(cell(1));
  });

  it('lays its cells out left to right even in a right-to-left page', () => {
    render(
      <div dir="rtl">
        <TicTacToeNote labels={labels} />
      </div>,
    );
    expect(cell(1).parentElement?.getAttribute('dir')).toBe('ltr');
  });

  it('keeps focus on a cell after it is played, and does not replay a taken one', async () => {
    const user = userEvent.setup();
    render(<TicTacToeNote labels={labels} />);
    cell(1).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(cell(1));
    expect(cell(1).getAttribute('aria-label')).toContain('X');
    await user.keyboard('{Enter}');
    expect(cell(1).getAttribute('aria-label')).toContain('X');
    expect(screen.getAllByRole('button', { name: /^الخانة \d، X/ })).toHaveLength(1);
  });
});
