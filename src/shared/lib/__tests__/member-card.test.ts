import { describe, expect, it } from 'vitest';

import {
  CARD_STAMPS_TOTAL,
  cardMoodForClub,
  cardToneFor,
  cardYears,
  chartCellValue,
  memberCodeForMembership,
  stampIsHalf,
  stampsForPoints,
  withKashida,
} from '../member-card';

describe('member card rules', () => {
  it('earns one stamp per 50 points, between zero and six', () => {
    expect(stampsForPoints(-30)).toBe(0);
    expect(stampsForPoints(0)).toBe(0);
    expect(stampsForPoints(49)).toBe(0);
    expect(stampsForPoints(50)).toBe(1);
    expect(stampsForPoints(149)).toBe(2);
    expect(stampsForPoints(300)).toBe(CARD_STAMPS_TOTAL);
    expect(stampsForPoints(100_000)).toBe(CARD_STAMPS_TOTAL);
  });

  it('gives UQU Computing the Gem mood and every other club the host Tech mood', () => {
    expect(cardMoodForClub('computing')).toBe('gem');
    expect(cardMoodForClub('tuwaiq')).toBe('tech');
    expect(cardMoodForClub('any-new-club')).toBe('tech');
  });

  it('prints the last eight characters of the membership id as the member code', () => {
    expect(memberCodeForMembership('01900000-0000-7000-8000-00000000abcd')).toBe('DM-0000ABCD');
  });

  it('reads both years in the Kingdom calendar, Western digits', () => {
    const { hijriYear, gregorianYear } = cardYears(new Date('2026-11-24T09:00:00Z'));
    expect(gregorianYear).toBe(2026);
    expect(hijriYear).toBe(1448);
  });
});

describe('half stamps', () => {
  it('fills half a box once half of the next stamp is earned, never at the top', () => {
    expect(stampIsHalf(0)).toBe(false);
    expect(stampIsHalf(24)).toBe(false);
    expect(stampIsHalf(25)).toBe(true);
    expect(stampIsHalf(49)).toBe(true);
    expect(stampIsHalf(50)).toBe(false);
    expect(stampIsHalf(75)).toBe(true);
    expect(stampIsHalf(275)).toBe(true);
    // All six stamps are earned: there is no next box to half fill.
    expect(stampIsHalf(300)).toBe(false);
    expect(stampIsHalf(325)).toBe(false);
    expect(stampIsHalf(-40)).toBe(false);
  });

  it('sizes a chart cell at 10, 25, 50 or 100 points, the smallest that fits the best month', () => {
    expect(chartCellValue(0, 8)).toBe(10);
    expect(chartCellValue(80, 8)).toBe(10);
    expect(chartCellValue(81, 8)).toBe(25);
    expect(chartCellValue(200, 8)).toBe(25);
    expect(chartCellValue(201, 8)).toBe(50);
    expect(chartCellValue(400, 8)).toBe(50);
    expect(chartCellValue(401, 8)).toBe(100);
    expect(chartCellValue(5000, 8)).toBe(100);
  });
});

describe('badge tone', () => {
  it('dresses officers and committee leads in matte and everyone else in white', () => {
    expect(cardToneFor({ clubRole: 'MEMBER', ledCommittees: [] })).toBe('paper');
    expect(cardToneFor({ clubRole: 'MEMBER', ledCommittees: ['لجنة التطوير'] })).toBe('matte');
    expect(cardToneFor({ clubRole: 'CLUB_OFFICER', ledCommittees: [] })).toBe('matte');
  });
});

describe('kashida', () => {
  const tatweel = 'ـ';

  it('stretches a short name after a joining letter, never before the article', () => {
    const stretched = withKashida('نورة خالد الحربي');
    expect(stretched).toContain(`ن${tatweel}`);
    expect(stretched).toContain(`الح${tatweel}`);
    expect(stretched).not.toContain(`ال${tatweel}`);
    expect(stretched.replaceAll(tatweel, '')).toBe('نورة خالد الحربي');
  });

  it('never stretches into an alef or inside a lam-alef, and leaves such a word as it is', () => {
    // خ would stretch before the alef (خـالد), ل would stretch before the د: neither is set.
    expect(withKashida('خالد')).toBe('خالد');
    expect(withKashida('جلال')).not.toContain(`ل${tatweel}`);
    const stretched = withKashida('سعد');
    expect(stretched).toContain(`سع${tatweel}`);
    expect(stretched).not.toMatch(new RegExp(`${tatweel}[اأإآ]`, 'u'));
  });

  it('prefers the middle of a word, and caps one stretch', () => {
    // The ح in the middle of «محمد» beats the م that starts it.
    expect(withKashida('محمد')).toMatch(new RegExp(`^مح${tatweel}+مد$`, 'u'));
    expect(withKashida('سعد').match(new RegExp(tatweel, 'gu'))?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('leaves a long name alone so it still fits on one line', () => {
    const long = 'عبدالرحمن بن محمد بن عبدالله الغامدي';
    expect(withKashida(long)).toBe(long);
  });

  it('never ends up with a stretch that cannot join', () => {
    // و joins to nothing after it, so no tatweel may follow it.
    expect(withKashida('رود')).toBe('رود');
  });
});
