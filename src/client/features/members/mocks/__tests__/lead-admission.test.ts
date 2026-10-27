import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiError, createApiClient } from '@/client/lib/api-client';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { admitMemberEndpoint } from '@/shared/contracts/members';
import {
  confirmCommitteeMemberImportEndpoint,
  previewCommitteeMemberImportEndpoint,
} from '@/shared/contracts/members-import';
import { demoClubs, demoKeys } from '@/shared/demo/demo';
import { demoId } from '@/shared/demo/ids';

/*
 * A committee lead bringing people into their committee on mocks
 * (docs/adr/0029-leads-add-members.md): one at a time and from a file, always with «عضو», and a
 * 404 for any committee they do not lead.
 */

const BASE_URL = 'http://localhost:3000';
/** ريم leads the design committee of the Computing club (README "Seeded accounts"). */
const LEAD = 's000000005@st.uqu.edu.sa';
const lead = createApiClient({
  baseUrl: BASE_URL,
  headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(LEAD)}` },
});

const computing = demoClubs.find((club) => club.key === 'computing');
if (!computing) throw new Error('The demo dataset has no Computing club.');
const committeeId = (key: string) => demoId(demoKeys.committee(computing.key, key));
const design = committeeId('design');
const designName = computing.committees.find((committee) => committee.key === 'design')?.name;

const file = (...lines: string[]) =>
  Buffer.from(['الاسم الكامل,البريد الجامعي,نوع العضوية,اللجان', ...lines].join('\n')).toString(
    'base64',
  );

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('a lead bringing people into their committee, on mocks', () => {
  it('adds one person with «عضو», in the committee from the URL', async () => {
    const member = await lead.request(admitMemberEndpoint, {
      params: { committeeId: design },
      body: { person: { uniEmail: 's441950001@uqu.edu.sa', fullName: 'طالب للتصميم' } },
    });
    expect(member.membershipType.name).toBe('عضو');
    expect(member.committees.map((committee) => committee.id)).toEqual([design]);

    const again = await lead
      .request(admitMemberEndpoint, {
        params: { committeeId: design },
        body: { person: { uniEmail: 's441950001@uqu.edu.sa', fullName: 'طالب للتصميم' } },
      })
      .catch((error: unknown) => error);
    expect(again).toBeInstanceOf(ApiError);
    expect((again as ApiError).details.reason).toBe('already_in_committee');
  });

  it('is a 404 in a committee they do not lead', async () => {
    const error = await lead
      .request(admitMemberEndpoint, {
        params: { committeeId: committeeId('programming') },
        body: { person: { uniEmail: 's441950002@uqu.edu.sa', fullName: 'طالب' } },
      })
      .catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(404);
  });

  it('imports a file into the committee, ignoring types and refusing other committees', async () => {
    const csv = file(
      's441950011,s441950011@uqu.edu.sa,عضو فعال,',
      `s441950012,s441950012@uqu.edu.sa,,${designName ?? ''}`,
      's441950013,s441950013@uqu.edu.sa,,لجنة البرمجة',
    );
    const preview = await lead.request(previewCommitteeMemberImportEndpoint, {
      params: { committeeId: design },
      body: { file: csv },
    });
    expect(preview.notices).toEqual(['membership_type_ignored']);
    expect(preview.rows.map((row) => row.status)).toEqual(['add', 'add', 'invalid']);
    expect(preview.rows[2]?.issues).toEqual([
      { field: 'committees', code: 'committee_not_target', value: 'لجنة البرمجة' },
    ]);

    const result = await lead.request(confirmCommitteeMemberImportEndpoint, {
      params: { committeeId: design },
      body: { file: csv, checksum: preview.checksum },
    });
    expect(result).toMatchObject({ added: 2, skippedInvalid: 1 });
  });
});
