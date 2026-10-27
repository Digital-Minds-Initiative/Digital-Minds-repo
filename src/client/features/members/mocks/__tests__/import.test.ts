import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '@/client/lib/api-client';
import { getMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  confirmMemberImportEndpoint,
  previewMemberImportEndpoint,
} from '@/shared/contracts/members-import';
import { demoClubs, demoKeys } from '@/shared/demo/demo';
import { demoId } from '@/shared/demo/ids';

/*
 * The import screens are built against these handlers, so they have to behave: the same two
 * steps, the same row states and the same 409 when the import no longer matches the preview.
 * Requests and responses are validated against the contracts by mockEndpoint itself.
 */

const BASE_URL = 'http://localhost:3000';
const asActor = (uniEmail: string) =>
  createApiClient({
    baseUrl: BASE_URL,
    headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(uniEmail)}` },
  });

/** Seeded personas (README "Seeded accounts"): سارة is an officer of the Computing club. */
const OFFICER = 's000000001@st.uqu.edu.sa';
const LEAD = 's000000005@st.uqu.edu.sa'; // ريم: leads one committee of the Computing club

const file = (...lines: string[]) =>
  Buffer.from(
    ['الاسم الكامل,البريد الجامعي,رقم الجوال,نوع العضوية,اللجان', ...lines].join('\n'),
  ).toString('base64');

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the CSV import on mocks', () => {
  // The Computing club, whose officer سارة is, with one of its committees by name.
  const club = demoClubs.find((candidate) => candidate.key === 'computing');
  if (!club) throw new Error('The demo dataset has no Computing club.');
  const clubId = demoId(demoKeys.club(club.key));
  const committeeName = club.committees[0]?.name ?? '';
  const officer = asActor(OFFICER);

  const preview = (csv: string, as = officer) =>
    as.request(previewMemberImportEndpoint, { params: { clubId }, body: { file: csv } });

  it('previews a file, then imports exactly what it previewed', async () => {
    const csv = file(
      `طالب الاختبار,s441900001@uqu.edu.sa,0551110077,,${committeeName}`,
      'طالبة الاختبار,s441900002@uqu.edu.sa,,,',
    );
    const planned = await preview(csv);
    expect(planned.summary).toMatchObject({ total: 2, add: 2, invalid: 0 });
    expect(planned.rows.map((row) => row.line)).toEqual([2, 3]);
    expect(planned.checksum).toMatch(/^[0-9a-f]{64}$/);

    const before = getMockDb().memberships.length;
    const result = await officer.request(confirmMemberImportEndpoint, {
      params: { clubId },
      body: { file: csv, checksum: planned.checksum },
    });
    expect(result).toEqual({
      added: 2,
      restored: 0,
      joined: 0,
      skippedExisting: 0,
      skippedInvalid: 0,
    });
    expect(getMockDb().memberships).toHaveLength(before + 2);

    // Previewing the same file again now shows them as members, so the old checksum is stale.
    const again = await preview(csv);
    expect(again.summary).toMatchObject({ existing: 2, add: 0 });
    await expect(
      officer.request(confirmMemberImportEndpoint, {
        params: { clubId },
        body: { file: csv, checksum: planned.checksum },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { reason: 'import_changed' },
    });
  });

  it('adds an existing member to the committees they are not in, and nothing else', async () => {
    const other = club.committees[1]?.name ?? '';
    const csv = file(`طالب اللجان,s441900401@uqu.edu.sa,,,${committeeName}`);
    const first = await preview(csv);
    await officer.request(confirmMemberImportEndpoint, {
      params: { clubId },
      body: { file: csv, checksum: first.checksum },
    });

    const again = file(`طالب اللجان,s441900401@uqu.edu.sa,,,${committeeName}،${other}`);
    const planned = await preview(again);
    expect(planned.rows[0]).toMatchObject({ status: 'join', joinCommittees: [other] });
    expect(planned.summary).toMatchObject({ join: 1, existing: 0 });
    const result = await officer.request(confirmMemberImportEndpoint, {
      params: { clubId },
      body: { file: again, checksum: planned.checksum },
    });
    expect(result).toMatchObject({ added: 0, joined: 1 });
    expect((await preview(again)).rows[0]?.status).toBe('existing');
  });

  it('reports the problems a row has, with the names it could not match', async () => {
    const planned = await preview(
      file(
        ',s441900101@uqu.edu.sa,0abc,ذهبي,',
        'طالب مكرر,s441900102@uqu.edu.sa,,,',
        'طالب مكرر,s441900102@uqu.edu.sa,,,',
        'طالب بلجنة غريبة,s441900103@uqu.edu.sa,,,لجنة لا توجد',
      ),
    );
    expect(planned.rows.map((row) => row.status)).toEqual(['invalid', 'add', 'invalid', 'invalid']);
    expect(planned.rows[0]?.issues.map((issue) => issue.code)).toEqual([
      'required',
      'invalid_phone',
      'unknown_membership_type',
    ]);
    expect(planned.rows[2]?.issues[0]).toMatchObject({ code: 'duplicate_in_file', at: 3 });
    expect(planned.rows[3]?.issues[0]).toMatchObject({
      code: 'unknown_committee',
      value: 'لجنة لا توجد',
    });
  });

  it('refuses a file that is not UTF-8, as the server does', async () => {
    const windows1256 = Buffer.from([0xc7, 0xe1, 0xe3, 0xcf, 0xed, 0xe4, 0xe9]).toString('base64');
    await expect(preview(windows1256)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
    });
  });

  it('lists the columns it ignored', async () => {
    const csv = Buffer.from(
      ['الاسم الكامل,البريد الجامعي,ملاحظات', 'طالب,s441900201@uqu.edu.sa,زائر'].join('\n'),
    ).toString('base64');
    expect((await preview(csv)).ignoredColumns).toEqual(['ملاحظات']);
  });

  it('refuses a committee lead with the rule the UI shows', async () => {
    await expect(
      preview(file('طالب,s441900301@uqu.edu.sa,,,'), asActor(LEAD)),
    ).rejects.toMatchObject({ status: 403, details: { reason: 'club_management_required' } });
  });
});
