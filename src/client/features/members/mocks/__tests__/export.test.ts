import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import {
  MEMBER_EXPORT_CONTENT_TYPE,
  type MemberExportBodyInput,
} from '@/shared/contracts/members-export';
import { demoClubs, demoKeys } from '@/shared/demo/demo';
import { demoId } from '@/shared/demo/ids';
import { openWorkbook } from '@tests/utils/xlsx';

/*
 * The export button and the column picker are built against this handler, so it must answer the
 * way the server does: a real .xlsx with the requested columns, and the server's refusals.
 */

const BASE_URL = 'http://localhost:3000';
/** Seeded personas (README "Seeded accounts"). */
const OFFICER = 's000000001@st.uqu.edu.sa'; // سارة: officer of the Computing club
const LEAD = 's000000005@st.uqu.edu.sa'; // ريم: leads one committee of the Computing club

function idOf(key: string): string {
  const club = demoClubs.find((candidate) => candidate.key === key);
  if (!club) throw new Error(`The demo dataset has no ${key} club.`);
  return demoId(demoKeys.club(club.key));
}

function exportAs(uniEmail: string, clubId: string, body: MemberExportBodyInput) {
  return fetch(`${BASE_URL}/api/v1/clubs/${clubId}/members/export`, {
    method: 'POST',
    headers: {
      cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(uniEmail)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the members export on mocks', () => {
  const computing = idOf('computing');

  it('answers with a real xlsx holding the requested columns', async () => {
    const response = await exportAs(OFFICER, computing, {
      columns: ['fullName', 'phone', 'points'],
      selection: { kind: 'all' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(MEMBER_EXPORT_CONTENT_TYPE);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="members-computing-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/,
    );

    const book = await openWorkbook(new Uint8Array(await response.arrayBuffer()));
    const rows = book.sheets.get('الأعضاء') ?? [];
    expect(rows[0]).toEqual(['الاسم الكامل', 'الجوال', 'النقاط']);
    expect(rows.length).toBeGreaterThan(1);
    expect(book.sheetXml(1)).toMatch(/rightToLeft="1"/);
  });

  it('refuses ticked members outside the list, and clubs the persona cannot list', async () => {
    const rejected = await exportAs(OFFICER, computing, {
      columns: ['fullName'],
      selection: { kind: 'ids', memberIds: ['0192d000-0000-7000-8000-00000000dead'] },
    });
    expect(rejected.status).toBe(422);
    const error = ((await rejected.json()) as ErrorEnvelope).error;
    expect(error.reason).toBe('entries_rejected');
    expect(error.issues?.[0]?.path).toEqual(['body', 'selection', 'memberIds', 0]);

    const elsewhere = await exportAs(LEAD, idOf('tuwaiq'), {
      columns: ['fullName'],
      selection: { kind: 'all' },
    });
    expect(elsewhere.status).toBe(404);
  });

  it('validates the body with the contract', async () => {
    const response = await exportAs(OFFICER, computing, {
      // @ts-expect-error -- not a column
      columns: ['salary'],
      selection: { kind: 'all' },
    });
    expect(response.status).toBe(422);
  });
});
