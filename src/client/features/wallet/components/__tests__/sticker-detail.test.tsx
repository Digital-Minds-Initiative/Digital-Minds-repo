// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CustomStickerDef } from '@/shared/lib/stickers';
import { renderWithProviders } from '@tests/utils/render';

import { StickerDetail, type StickerFacts } from '../sticker-detail';

const custom: CustomStickerDef = {
  key: 'custom:01900000-0000-7000-8000-00000000abcd',
  name: 'بطل الهاكاثون',
  howTo: 'يقود فريقه للفوز في هاكاثون النادي',
  label: 'بطل',
  icon: 'trophy',
  shape: 'shield',
  background: 'indigo',
  ink: 'white',
  hidden: false,
  rarity: 'RARE',
  availableFrom: null,
  availableUntil: null,
};

const held: StickerFacts = {
  key: custom.key,
  custom,
  held: true,
  source: 'awarded',
  earnedAt: '2026-11-01T10:00:00.000Z',
  reason: 'قاد الفريق بدون ما نطلب',
};

describe('a sticker page', () => {
  it('tells its owner how to get it, how they got it, when and what for', () => {
    renderWithProviders(<StickerDetail facts={held} viewer="owner" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'بطل الهاكاثون' });
    expect(within(dialog).getByText('يقود فريقه للفوز في هاكاثون النادي')).toBeTruthy();
    expect(within(dialog).getByText('كيف حصلت عليه')).toBeTruthy();
    expect(within(dialog).getByText('منحه إياه مسؤول في النادي أو اللجنة')).toBeTruthy();
    expect(within(dialog).getByText('قاد الفريق بدون ما نطلب')).toBeTruthy();
    expect(dialog.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-01T10:00:00.000Z');
    expect(within(dialog).getByRole('img', { name: 'بطل الهاكاثون' })).toBeTruthy();
  });

  it('words it for a visitor in the third person', () => {
    renderWithProviders(<StickerDetail facts={held} viewer="visitor" onClose={vi.fn()} />);
    expect(screen.getByText('كيف حصل عليه')).toBeTruthy();
    expect(screen.queryByText('كيف حصلت عليه')).toBeNull();
  });

  it('says a sticker given by a rule is worked out, with no single moment', () => {
    renderWithProviders(
      <StickerDetail
        facts={{
          key: 'k',
          custom: null,
          held: true,
          source: 'points',
          earnedAt: null,
          reason: null,
        }}
        viewer="owner"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('لحظة تحقق شرطه، وهو يُحسب تلقائياً')).toBeTruthy();
    expect(screen.getByText('تلقائياً، لأنه جمع النقاط المطلوبة')).toBeTruthy();
  });

  it('keeps a hidden sticker nobody holds a secret: no name, no way to get it', () => {
    renderWithProviders(
      <StickerDetail
        facts={{
          key: 'legend',
          custom: null,
          held: false,
          source: null,
          earnedAt: null,
          reason: null,
        }}
        viewer="owner"
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'ملصق سرّي' });
    expect(within(dialog).getByText(/ما يُعرف كيف يُنال/)).toBeTruthy();
    expect(within(dialog).queryByText(/مسؤول النادي وحده/)).toBeNull();
    expect(within(dialog).queryByText('كيف حصلت عليه')).toBeNull();
  });

  it('is closed when there is nothing to show', () => {
    renderWithProviders(<StickerDetail facts={null} viewer="owner" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
