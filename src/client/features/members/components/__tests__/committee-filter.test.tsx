// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { CommitteeFilter } from '../committee-filter';

const committees = [
  { id: 'a', name: 'لجنة الإعلام' },
  { id: 'b', name: 'لجنة البرمجة' },
  { id: 'c', name: 'لجنة التصميم' },
];

beforeAll(() => {
  // Radix measures its popper content; jsdom has no ResizeObserver or pointer capture.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

function Harness({ onValue }: { onValue: (value: string | undefined) => void }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return (
    <CommitteeFilter
      committees={committees}
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        onValue(next);
      }}
    />
  );
}

async function openMenu() {
  let latest: string | undefined;
  const user = userEvent.setup();
  renderWithProviders(<Harness onValue={(value) => (latest = value)} />);
  await user.click(screen.getByLabelText('اللجنة'));
  return { user, value: () => latest };
}

describe('CommitteeFilter', () => {
  it('shows "all committees" until one is picked', async () => {
    await openMenu();
    expect(screen.getByLabelText('اللجنة').textContent).toContain('كل اللجان');
    // One radio per committee, plus "all committees".
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
    expect(
      screen.getByRole('menuitemradio', { name: 'كل اللجان' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('picks one committee and shows its name', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemradio', { name: 'لجنة البرمجة' }));
    expect(value()).toBe('b');
    expect(screen.getByLabelText('اللجنة').textContent).toContain('لجنة البرمجة');
  });

  it('replaces the choice rather than adding to it', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemradio', { name: 'لجنة الإعلام' }));
    expect(value()).toBe('a');
    await user.click(screen.getByLabelText('اللجنة'));
    await user.click(screen.getByRole('menuitemradio', { name: 'لجنة التصميم' }));
    expect(value()).toBe('c');
    expect(screen.getByLabelText('اللجنة').textContent).toContain('لجنة التصميم');
  });

  it('clears the choice with "all committees"', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemradio', { name: 'لجنة الإعلام' }));
    await user.click(screen.getByLabelText('اللجنة'));
    await user.click(screen.getByRole('menuitemradio', { name: 'كل اللجان' }));
    expect(value()).toBeUndefined();
    expect(screen.getByLabelText('اللجنة').textContent).toContain('كل اللجان');
  });
});
