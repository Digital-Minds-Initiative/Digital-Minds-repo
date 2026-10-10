import { describe, expect, it } from 'vitest';

import { normalizeForSearch, toLatinDigits } from '../arabic';

describe('normalizeForSearch', () => {
  it('treats alef variants as the same letter', () => {
    expect(normalizeForSearch('أحمد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إبراهيم')).toBe('ابراهيم');
    expect(normalizeForSearch('آمنة')).toBe(normalizeForSearch('امنه'));
  });

  it('unifies taa marbuta, alef maqsura and hamza seats', () => {
    expect(normalizeForSearch('فاطمة')).toBe('فاطمه');
    expect(normalizeForSearch('مصطفى')).toBe('مصطفي');
    expect(normalizeForSearch('مؤمن')).toBe('مومن');
    expect(normalizeForSearch('عائشة')).toBe('عايشه');
  });

  it('removes diacritics and tatweel', () => {
    expect(normalizeForSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeForSearch('محـــمد')).toBe('محمد');
  });

  it('collapses whitespace and lower-cases Latin text', () => {
    expect(normalizeForSearch('  Sara   AL-Qahtani ')).toBe('sara al-qahtani');
  });

  it('finds a name typed without hamza inside the stored name', () => {
    const stored = normalizeForSearch('عبدالرحمن فيصل القرشي');
    expect(stored.includes(normalizeForSearch('القرشى'))).toBe(true);
  });
});

describe('toLatinDigits', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(toLatinDigits('٠٥٥١٢٣')).toBe('055123');
    expect(toLatinDigits('۰۵۵')).toBe('055');
  });
});
