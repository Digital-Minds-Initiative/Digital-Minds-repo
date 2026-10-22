import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as exportRoute } from '@/app/api/v1/clubs/[clubId]/members/export/route';
import { db } from '@/server/db/client';
import {
  MEMBER_EXPORT_CONTENT_TYPE,
  MEMBER_EXPORT_MAX_ROWS,
} from '@/shared/contracts/members-export';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute, errorOf } from '@tests/utils/route';
import { openWorkbook } from '@tests/utils/xlsx';

/*
 * The export endpoint through the real route handler: the status each caller gets, the headers a
 * download needs, and the envelopes the frontend reads its errors from.
 */

describe('POST /clubs/:clubId/members/export', () => {
  let s: Scenario;

  function call(clubId: string, body: unknown, actor?: string, headers?: Record<string, string>) {
    return callRoute(exportRoute, {
      method: 'POST',
      path: `/api/v1/clubs/${clubId}/members/export`,
      params: { clubId },
      body,
      actor,
      headers,
    });
  }

  const everyone = { columns: ['fullName', 'phone'], selection: { kind: 'all' } };

  beforeAll(async () => {
    s = await buildScenario();
  });

  beforeEach(async () => {
    await db.rateLimitCounter.deleteMany();
  });

  it('downloads an xlsx file with an ASCII and an Arabic name, never cached', async () => {
    const response = await call(s.clubA.id, everyone, s.users.officerA.uniEmail);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(MEMBER_EXPORT_CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(
      new RegExp(`^attachment; filename="members-${s.clubA.slug}-\\d{4}-\\d{2}-\\d{2}\\.xlsx"; `),
    );
    const encoded = /filename\*=UTF-8''(.+)$/.exec(disposition)?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toMatch(/^أعضاء-نادي-أ-\d{4}-\d{2}-\d{2}\.xlsx$/);
    // Header-safe: only ASCII travels in the header itself.
    expect(/^[\x20-\x7e]*$/.test(disposition)).toBe(true);

    const book = await openWorkbook(new Uint8Array(await response.arrayBuffer()));
    expect(book.sheets.get('الأعضاء')?.[0]).toEqual(['الاسم الكامل', 'الجوال']);
  });

  it('is a 401 without a session', async () => {
    const response = await call(s.clubA.id, everyone);
    expect(response.status).toBe(401);
  });

  it('is a 404 for an ordinary member and for an officer of another club', async () => {
    for (const actor of [s.users.plain.uniEmail, s.users.officerB.uniEmail]) {
      const response = await call(s.clubA.id, everyone, actor);
      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe('NOT_FOUND');
    }
  });

  it('answers 422 for an unknown column, with the path of the column', async () => {
    const response = await call(
      s.clubA.id,
      { columns: ['fullName', 'salary'], selection: { kind: 'all' } },
      s.users.officerA.uniEmail,
    );
    expect(response.status).toBe(422);
    expect((await errorOf(response)).issues).toEqual([
      expect.objectContaining({ path: ['body', 'columns', 1], code: 'invalid_value' }),
    ]);
  });

  it('answers 422 for duplicate ids and for more ids than one file holds', async () => {
    const duplicate = await call(
      s.clubA.id,
      {
        columns: ['fullName'],
        selection: { kind: 'ids', memberIds: [s.memberships.memberA1, s.memberships.memberA1] },
      },
      s.users.officerA.uniEmail,
    );
    expect((await errorOf(duplicate)).issues?.[0]).toMatchObject({
      path: ['body', 'selection', 'memberIds'],
      code: 'duplicate_ids',
    });

    const tooMany = await call(
      s.clubA.id,
      {
        columns: ['fullName'],
        selection: {
          kind: 'ids',
          memberIds: Array.from(
            { length: MEMBER_EXPORT_MAX_ROWS + 1 },
            (_, index) => `0192d000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          ),
        },
      },
      s.users.officerA.uniEmail,
    );
    expect(tooMany.status).toBe(422);
    expect((await errorOf(tooMany)).issues?.[0]).toMatchObject({
      path: ['body', 'selection', 'memberIds'],
      code: 'too_big',
    });
  });

  it('answers 422 entries_rejected naming each ticked member that is not in the list', async () => {
    const response = await call(
      s.clubA.id,
      {
        columns: ['fullName'],
        selection: { kind: 'ids', memberIds: [s.memberships.memberA1, s.memberships.memberB1] },
      },
      s.users.officerA.uniEmail,
    );
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.reason).toBe('entries_rejected');
    expect(error.issues).toEqual([
      { path: ['body', 'selection', 'memberIds', 1], code: 'not_found', message: 'not_found' },
    ]);
  });

  it('answers 429 with Retry-After once the hour’s exports are spent', async () => {
    for (let index = 0; index < 30; index += 1) {
      expect((await call(s.clubB.id, everyone, s.users.officerB.uniEmail)).status).toBe(200);
    }
    const response = await call(s.clubB.id, everyone, s.users.officerB.uniEmail);
    expect(response.status).toBe(429);
    const error = await errorOf(response);
    expect(error.reason).toBe('too_many_requests');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refuses a body sent from another origin, like every write', async () => {
    const response = await callRoute(exportRoute, {
      method: 'POST',
      path: `/api/v1/clubs/${s.clubA.id}/members/export`,
      params: { clubId: s.clubA.id },
      body: everyone,
      actor: s.users.officerA.uniEmail,
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
  });
});
