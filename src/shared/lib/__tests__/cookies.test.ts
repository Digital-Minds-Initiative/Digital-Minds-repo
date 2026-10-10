import { describe, expect, it } from 'vitest';

import { readCookie } from '../cookies';

describe('readCookie', () => {
  it('finds a cookie by exact name and decodes its value', () => {
    const header = 'dm-theme=dark; dm-dev-actor=s443001102%40st.uqu.edu.sa';
    expect(readCookie(header, 'dm-dev-actor')).toBe('s443001102@st.uqu.edu.sa');
    expect(readCookie(header, 'dm-theme')).toBe('dark');
    expect(readCookie(header, 'theme')).toBeNull();
  });

  it('returns null for a missing header or a malformed value', () => {
    expect(readCookie(null, 'dm-theme')).toBeNull();
    expect(readCookie('', 'dm-theme')).toBeNull();
    expect(readCookie('dm-dev-actor=%E0%A4%A', 'dm-dev-actor')).toBeNull();
  });
});
