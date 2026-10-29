import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '@/client/lib/api-client';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  createMemberEndpoint,
  listMembersEndpoint,
  updateMemberEndpoint,
} from '@/shared/contracts/members';
import {
  confirmMemberImportEndpoint,
  previewMemberImportEndpoint,
} from '@/shared/contracts/members-import';
import { demoClubs, demoKeys } from '@/shared/demo/demo';
import { demoId } from '@/shared/demo/ids';

/*
 * The members screen's gender column, filter and form fields are built against these handlers,
 * so they store, filter and import the gender the way the server does.
 */

const BASE_URL = 'http://localhost:3000';
/** سارة is an officer of the Computing club (README "Seeded accounts"). */
const officer = createApiClient({
  baseUrl: BASE_URL,
  headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent('s000000001@st.uqu.edu.sa')}` },
});

const computing = demoClubs.find((club) => club.key === 'computing');
if (!computing) throw new Error('The demo dataset has no Computing club.');
const clubId = demoId(demoKeys.club(computing.key));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('gender on mocks', () => {
  const list = async (gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED') =>
    (
      await officer.request(listMembersEndpoint, {
        query: { clubId, pageSize: 100, ...(gender ? { gender } : {}) },
      })
    ).items;

  it('filters by gender, and UNSPECIFIED by none', async () => {
    const all = await list();
    for (const gender of ['MALE', 'FEMALE'] as const) {
      const items = await list(gender);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((member) => member.profile.gender === gender)).toBe(true);
    }
    expect((await list('UNSPECIFIED')).map((member) => member.id)).toEqual(
      all.filter((member) => member.profile.gender === null).map((member) => member.id),
    );
  });

  it('stores it on add and changes it on edit', async () => {
    const member = await officer.request(createMemberEndpoint, {
      params: { clubId },
      body: {
        person: { uniEmail: 's441960001@uqu.edu.sa', fullName: 'طالبة جديدة' },
        profile: { gender: 'FEMALE' },
      },
    });
    expect(member.profile.gender).toBe('FEMALE');
    const edited = await officer.request(updateMemberEndpoint, {
      params: { memberId: member.id },
      body: { gender: null },
    });
    expect(edited.profile.gender).toBeNull();
  });

  it('reads the import column and refuses an unknown value', async () => {
    const file = Buffer.from(
      [
        'الاسم الكامل,البريد الجامعي,الجنس',
        'طالب أول,s441960002@uqu.edu.sa,ذكر',
        'طالب ثان,s441960003@uqu.edu.sa,ولد',
      ].join('\n'),
    ).toString('base64');
    const preview = await officer.request(previewMemberImportEndpoint, {
      params: { clubId },
      body: { file },
    });
    expect(preview.rows.map((row) => row.status)).toEqual(['add', 'invalid']);
    expect(preview.rows[1]?.issues).toEqual([{ field: 'gender', code: 'invalid_gender' }]);

    await officer.request(confirmMemberImportEndpoint, {
      params: { clubId },
      body: { file, checksum: preview.checksum },
    });
    const added = (await list('MALE')).find(
      (member) => member.user.uniEmail === 's441960002@uqu.edu.sa',
    );
    expect(added?.profile.gender).toBe('MALE');
  });
});
