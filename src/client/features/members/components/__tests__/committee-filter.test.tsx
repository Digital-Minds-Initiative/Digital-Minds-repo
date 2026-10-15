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

function Harness({ onValue }: { onValue: (value: string[] | undefined) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <CommitteeFilter
      committees={committees}
      selected={selected}
      onChange={(next) => {
        setSelected(next ?? []);
        onValue(next);
      }}
    />
  );
}

async function openMenu() {
  let latest: string[] | undefined;
  const user = userEvent.setup();
  renderWithProviders(<Harness onValue={(value) => (latest = value)} />);
  await user.click(screen.getByLabelText('اللجنة'));
  return { user, value: () => latest };
}

describe('CommitteeFilter', () => {
  it('shows "all committees" until something is ticked', async () => {
    await openMenu();
    expect(screen.getByLabelText('اللجنة').textContent).toContain('كل اللجان');
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(3);
  });

  it('lets several committees be ticked at once and keeps the menu open', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'لجنة الإعلام' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'لجنة التصميم' }));
    expect(value()).toEqual(['a', 'c']);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'لجنة الإعلام' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'لجنة البرمجة' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByLabelText('اللجنة').textContent).toContain('لجنتان');
  });

  it('shows the name when one committee is ticked, and unticking the last clears the filter', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'لجنة البرمجة' }));
    expect(screen.getByLabelText('اللجنة').textContent).toContain('لجنة البرمجة');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'لجنة البرمجة' }));
    expect(value()).toBeUndefined();
  });

  it('clears every choice with "all committees"', async () => {
    const { user, value } = await openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'لجنة الإعلام' }));
    await user.click(screen.getByRole('menuitem', { name: 'كل اللجان' }));
    expect(value()).toBeUndefined();
  });
});
