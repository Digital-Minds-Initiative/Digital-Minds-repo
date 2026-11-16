import { describe, expect, it } from 'vitest';

import { matchesMemberSearch, phoneMatchesSearch, type SearchableMember } from '../member-search';

const sara: SearchableMember = {
  fullName: 'سارة عبدالرحمن القحطاني',
  uniEmail: 's4401234@st.uqu.edu.sa',
  phone: '+966512345678',
};
const noPhone: SearchableMember = { ...sara, phone: null };

describe('matchesMemberSearch', () => {
  it('matches everyone when the search is empty or only spaces', () => {
    expect(matchesMemberSearch(sara, '')).toBe(true);
    expect(matchesMemberSearch(sara, '   ')).toBe(true);
  });

  it('finds a name ignoring Arabic letter variants, diacritics and case', () => {
    expect(matchesMemberSearch(sara, 'ساره')).toBe(true);
    expect(matchesMemberSearch(sara, 'القحطاني')).toBe(true);
    expect(matchesMemberSearch(sara, 'سَارَة')).toBe(true);
    expect(matchesMemberSearch({ ...sara, fullName: 'أحمد' }, 'احمد')).toBe(true);
    expect(matchesMemberSearch(sara, 'خالد')).toBe(false);
  });

  it('finds a university email in any case, whole or in part', () => {
    expect(matchesMemberSearch(sara, 'S4401234@ST.UQU.EDU.SA')).toBe(true);
    expect(matchesMemberSearch(sara, 's44012')).toBe(true);
    expect(matchesMemberSearch(sara, ' s4401234 ')).toBe(true);
    expect(matchesMemberSearch(sara, 's9999')).toBe(false);
  });

  it('finds a phone typed the way people write Saudi numbers', () => {
    for (const query of [
      '0512345678',
      '512345678',
      '+966512345678',
      '966512345678',
      '00966512345678',
      '051 234 5678',
      '051-234-5678',
      '٠٥١٢٣٤٥٦٧٨',
    ]) {
      expect(matchesMemberSearch(sara, query), query).toBe(true);
    }
    expect(matchesMemberSearch(sara, '0599999999')).toBe(false);
  });

  it('does not treat a short run of digits as a phone', () => {
    expect(matchesMemberSearch(sara, '512')).toBe(false);
    expect(matchesMemberSearch(sara, '5123')).toBe(true);
  });

  it('copes with a member who has no phone', () => {
    expect(matchesMemberSearch(noPhone, '0512345678')).toBe(false);
    expect(matchesMemberSearch(noPhone, 'ساره')).toBe(true);
    expect(matchesMemberSearch(noPhone, 's4401234')).toBe(true);
  });
});

describe('phoneMatchesSearch', () => {
  it('is true only for a search that is a phone and is in this number', () => {
    expect(phoneMatchesSearch(sara.phone, '0512345678')).toBe(true);
    expect(phoneMatchesSearch(sara.phone, 'سارة')).toBe(false);
    expect(phoneMatchesSearch(sara.phone, 's4401234')).toBe(false);
    expect(phoneMatchesSearch(sara.phone, '')).toBe(false);
    expect(phoneMatchesSearch(null, '0512345678')).toBe(false);
  });
});

describe('phone search and emails', () => {
  it('does not read the digits of an email or a name as a phone number', () => {
    expect(phoneMatchesSearch('+966544012345', 's4401234@st.uqu.edu.sa')).toBe(false);
    expect(phoneMatchesSearch('+966544012345', 'سارة 44012')).toBe(false);
    expect(
      matchesMemberSearch(
        { ...sara, uniEmail: 'x@st.uqu.edu.sa', phone: '+966544012345' },
        's44012',
      ),
    ).toBe(false);
  });
});
