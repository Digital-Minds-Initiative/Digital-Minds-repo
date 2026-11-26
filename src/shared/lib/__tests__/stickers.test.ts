import { describe, expect, it } from 'vitest';

import { cardToneFor, lastSixMonths } from '../member-card';
import {
  AWARDABLE_STICKER_KEYS,
  canAwardSticker,
  defaultPlacement,
  derivedStickers,
  MAX_PLACED_STICKERS,
  PLACEMENT_LIMITS,
  STICKER_KEYS,
  STICKER_RULES,
  THOUSAND_POINTS,
} from '../stickers';

describe('stickers earned by a rule', () => {
  const none = { clubRole: 'MEMBER' as const, ledCommittees: 0, points: 0, transactions: 0 };

  it('give a new member nothing', () => {
    expect(derivedStickers(none)).toEqual([]);
  });

  it('give an officer or a committee lead the lead sticker', () => {
    expect(derivedStickers({ ...none, clubRole: 'CLUB_OFFICER' })).toEqual(['lead']);
    expect(derivedStickers({ ...none, ledCommittees: 1 })).toEqual(['lead']);
  });

  it('give the thousand-points sticker at exactly a thousand, not before', () => {
    expect(derivedStickers({ ...none, points: THOUSAND_POINTS - 1 })).not.toContain('k');
    expect(derivedStickers({ ...none, points: THOUSAND_POINTS })).toContain('k');
  });

  it('give the first-achievement sticker once there is any active transaction', () => {
    expect(derivedStickers({ ...none, transactions: 1 })).toEqual(['first']);
  });
});

describe('who may award which sticker', () => {
  const officer = { fullAdmin: false, officer: true, lead: false };
  const lead = { fullAdmin: false, officer: false, lead: true };
  const nobody = { fullAdmin: false, officer: false, lead: false };
  const admin = { fullAdmin: true, officer: false, lead: false };

  it('lets an officer and a full admin award every awardable sticker', () => {
    for (const key of AWARDABLE_STICKER_KEYS) {
      expect(canAwardSticker(officer, key), key).toBe(true);
      expect(canAwardSticker(admin, key), key).toBe(true);
    }
  });

  it('lets a lead award all but the ones only officers give', () => {
    for (const key of AWARDABLE_STICKER_KEYS) {
      expect(canAwardSticker(lead, key), key).toBe(key !== 'founder' && key !== 'legend');
    }
  });

  it('lets nobody award for no standing', () => {
    for (const key of AWARDABLE_STICKER_KEYS) expect(canAwardSticker(nobody, key), key).toBe(false);
  });

  it('never lets anyone award a sticker a rule gives', () => {
    for (const key of STICKER_KEYS.filter((k) => STICKER_RULES[k].source !== 'awarded')) {
      expect(canAwardSticker(admin, key), key).toBe(false);
    }
  });

  it('lists exactly the stickers whose rule is "awarded"', () => {
    expect([...AWARDABLE_STICKER_KEYS].sort()).toEqual(
      STICKER_KEYS.filter((key) => STICKER_RULES[key].source === 'awarded').sort(),
    );
  });
});

describe('where a sticker first lands', () => {
  it('is on the card, turned a little, and a different place each time', () => {
    const spots = new Set<string>();
    for (let index = 0; index < MAX_PLACED_STICKERS; index++) {
      const placement = defaultPlacement('star', index);
      expect(placement.x).toBeGreaterThan(0);
      expect(placement.x).toBeLessThan(1);
      expect(placement.y).toBeGreaterThan(0);
      expect(placement.y).toBeLessThan(1);
      expect(Math.abs(placement.rotation)).toBeLessThanOrEqual(PLACEMENT_LIMITS.rotation.max);
      expect(placement.scale).toBe(1);
      spots.add(`${placement.x},${placement.y}`);
    }
    expect(spots.size).toBeGreaterThan(3);
  });
});

describe('the badge colour', () => {
  it('follows the role until chosen: officers and leads are matte, everyone else white', () => {
    expect(cardToneFor({ clubRole: 'MEMBER', ledCommittees: [] })).toBe('paper');
    expect(cardToneFor({ clubRole: 'CLUB_OFFICER', ledCommittees: [] })).toBe('matte');
    expect(cardToneFor({ clubRole: 'MEMBER', ledCommittees: ['x'] })).toBe('matte');
  });
});

describe('the months a card page charts', () => {
  it('are the last six, oldest first, ending with this one', () => {
    expect(lastSixMonths('2026-11-24')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('cross a year boundary without skipping or repeating a month', () => {
    expect(lastSixMonths('2027-02-03')).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(lastSixMonths('2026-01-31')[0]).toBe('2025-08');
  });
});

describe('custom sticker keys and rules', () => {
  it('knows a custom key by its prefix and a UUID, and nothing else', async () => {
    const { customStickerKey, isCustomStickerKey, customStickerId } = await import('../stickers');
    const id = '01900000-0000-7000-8000-00000000abcd';
    expect(isCustomStickerKey(customStickerKey(id))).toBe(true);
    expect(customStickerId(customStickerKey(id))).toBe(id);
    for (const bad of ['star', 'custom:', 'custom:abc', `custom:${id}x`, `Custom:${id}`, '']) {
      expect(isCustomStickerKey(bad), bad).toBe(false);
    }
  });

  it('lets the designer decide who gives it: any lead, or officers only', async () => {
    const { canAwardCustomSticker } = await import('../stickers');
    const lead = { fullAdmin: false, officer: false, lead: true };
    const officer = { fullAdmin: false, officer: true, lead: false };
    const nobody = { fullAdmin: false, officer: false, lead: false };
    expect(canAwardCustomSticker(lead, 'LEAD')).toBe(true);
    expect(canAwardCustomSticker(lead, 'OFFICER')).toBe(false);
    expect(canAwardCustomSticker(officer, 'OFFICER')).toBe(true);
    expect(canAwardCustomSticker(nobody, 'LEAD')).toBe(false);
  });

  it('keeps the hidden built-in sticker a surprise only a person gives', async () => {
    const { isHiddenBuiltin, derivedStickers } = await import('../stickers');
    expect(isHiddenBuiltin('legend')).toBe(true);
    expect(isHiddenBuiltin('star')).toBe(false);
    const everything = derivedStickers({
      clubRole: 'CLUB_OFFICER',
      ledCommittees: 2,
      points: 99_999,
      transactions: 9,
    });
    expect(everything).not.toContain('legend');
  });
});
