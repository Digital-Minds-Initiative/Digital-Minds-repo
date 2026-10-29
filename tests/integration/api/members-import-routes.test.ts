import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { POST as previewRoute } from '@/app/api/v1/clubs/[clubId]/members/import/preview/route';
import { POST as importRoute } from '@/app/api/v1/clubs/[clubId]/members/import/route';
import { GET as templateRoute } from '@/app/api/v1/clubs/[clubId]/members/import/template/route';
import { POST as committeePreviewRoute } from '@/app/api/v1/committees/[committeeId]/members/import/preview/route';
import { POST as committeeImportRoute } from '@/app/api/v1/committees/[committeeId]/members/import/route';
import { GET as committeeTemplateRoute } from '@/app/api/v1/committees/[committeeId]/members/import/template/route';
import { db } from '@/server/db/client';
import { DEV_ACTOR_HEADER } from '@/shared/contracts/auth';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import {
  memberImportColumns,
  previewMemberImportResponseSchema,
  memberImportResultSchema,
} from '@/shared/contracts/members-import';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { importFile, importFixture } from '@tests/utils/import-file';
import { APP_ORIGIN, callRoute, type Route } from '@tests/utils/route';

/*
 * The three import endpoints through the real route handlers: who gets which status, what the
 * bodies look like, and that the template downloads as a CSV file Excel can open.
 */

describe('the CSV import endpoints', () => {
  let s: Scenario;

  const file = () =>
    importFile(['الاسم الكامل,البريد الجامعي', 'طالب للاختبار,s441003001@uqu.edu.sa'].join('\n'));

  /** The shared helper (`@tests/utils/route`); every endpoint here takes a club id. */
  function call(
    route: Route,
    method: 'GET' | 'POST',
    path: string,
    options: { actor?: string; body?: unknown; clubId: string; headers?: Record<string, string> },
  ): Promise<Response> {
    const { clubId, ...rest } = options;
    return callRoute(route, { method, path, params: { clubId }, ...rest });
  }

  const endpoints = {
    preview: (clubId: string, actor?: string) =>
      call(previewRoute, 'POST', `/api/v1/clubs/${clubId}/members/import/preview`, {
        actor,
        clubId,
        body: { file: file() },
      }),
    import: (clubId: string, actor?: string) =>
      call(importRoute, 'POST', `/api/v1/clubs/${clubId}/members/import`, {
        actor,
        clubId,
        // A checksum that cannot match: a caller who may not import must never reach it, and a
        // caller who may gets 409 rather than writing something they have not seen.
        body: { file: file(), checksum: 'f'.repeat(64) },
      }),
    template: (clubId: string, actor?: string) =>
      call(templateRoute, 'GET', `/api/v1/clubs/${clubId}/members/import/template`, {
        actor,
        clubId,
      }),
  };

  const envelope = async (response: Response) => ((await response.json()) as ErrorEnvelope).error;

  beforeAll(async () => {
    s = await buildScenario();
  });

  describe('who may call them', () => {
    it('lets the club’s officer preview, import and download the template', async () => {
      const preview = await endpoints.preview(s.clubA.id, s.users.officerA.uniEmail);
      expect(preview.status).toBe(200);
      expect(previewMemberImportResponseSchema.safeParse(await preview.json()).success).toBe(true);

      // The checksum sent above is not the one the preview answered with.
      const confirmed = await endpoints.import(s.clubA.id, s.users.officerA.uniEmail);
      expect(confirmed.status).toBe(409);
      expect(await envelope(confirmed)).toMatchObject({ reason: 'import_changed' });

      expect((await endpoints.template(s.clubA.id, s.users.officerA.uniEmail)).status).toBe(200);
    });

    it('lets a full admin call them for any club', async () => {
      for (const clubId of [s.clubA.id, s.clubB.id]) {
        expect((await endpoints.preview(clubId, s.users.admin.uniEmail)).status).toBe(200);
        expect((await endpoints.template(clubId, s.users.admin.uniEmail)).status).toBe(200);
      }
    });

    it('refuses a committee lead with 403 on all three', async () => {
      // A lead sees the club, so the refusal is about their role and names the rule.
      for (const endpoint of Object.values(endpoints)) {
        const response = await endpoint(s.clubA.id, s.users.leadA1.uniEmail);
        expect(response.status).toBe(403);
        expect(await envelope(response)).toMatchObject({ reason: 'club_management_required' });
      }
    });

    it.each([
      ['a plain member of the club', (sc: Scenario) => sc.users.plain.uniEmail],
      ['an officer of another club', (sc: Scenario) => sc.users.officerB.uniEmail],
    ])('refuses %s with 404 — the club is not theirs to see', async (_, who) => {
      for (const endpoint of Object.values(endpoints)) {
        const response = await endpoint(s.clubA.id, who(s));
        expect(response.status).toBe(404);
        expect((await envelope(response)).code).toBe('NOT_FOUND');
      }
    });

    it('refuses a caller with no session with 401 on all three', async () => {
      for (const endpoint of Object.values(endpoints)) {
        const response = await endpoint(s.clubA.id);
        expect(response.status).toBe(401);
        expect((await envelope(response)).code).toBe('UNAUTHENTICATED');
      }
    });

    it('writes nothing on any refusal', async () => {
      const before = {
        users: await db.user.count(),
        memberships: await db.membership.count(),
      };
      for (const who of [undefined, s.users.leadA1.uniEmail, s.users.officerB.uniEmail]) {
        await endpoints.preview(s.clubA.id, who);
        await endpoints.import(s.clubA.id, who);
      }
      expect({
        users: await db.user.count(),
        memberships: await db.membership.count(),
      }).toEqual(before);
    });
  });

  describe('the CSRF rules still hold', () => {
    it('refuses a POST from another origin', async () => {
      const response = await call(
        previewRoute,
        'POST',
        `/api/v1/clubs/${s.clubA.id}/members/import/preview`,
        {
          actor: s.users.officerA.uniEmail,
          clubId: s.clubA.id,
          body: { file: file() },
          headers: { origin: 'https://evil.example' },
        },
      );
      expect(response.status).toBe(403);
      expect(await envelope(response)).toMatchObject({ reason: 'cross_origin' });
    });

    it('refuses a file sent as anything but JSON', async () => {
      const request = new NextRequest(
        `${APP_ORIGIN}/api/v1/clubs/${s.clubA.id}/members/import/preview`,
        {
          method: 'POST',
          headers: {
            origin: APP_ORIGIN,
            'content-type': 'text/csv',
            [DEV_ACTOR_HEADER]: s.users.officerA.uniEmail,
          },
          body: 'الاسم الكامل,البريد الجامعي',
        },
      );
      const response = await previewRoute(request, {
        params: Promise.resolve({ clubId: s.clubA.id }),
      });
      expect(response.status).toBe(400);
      expect(await envelope(response)).toMatchObject({ reason: 'json_required' });
    });
  });

  describe('the import', () => {
    it('imports the file the preview described, and answers with the counts', async () => {
      const csv = importFixture('arabic-headers.csv');
      const preview = await call(
        previewRoute,
        'POST',
        `/api/v1/clubs/${s.clubA.id}/members/import/preview`,
        { actor: s.users.officerA.uniEmail, clubId: s.clubA.id, body: { file: csv } },
      );
      const { checksum } = previewMemberImportResponseSchema.parse(await preview.json());

      const response = await call(
        importRoute,
        'POST',
        `/api/v1/clubs/${s.clubA.id}/members/import`,
        {
          actor: s.users.officerA.uniEmail,
          clubId: s.clubA.id,
          body: { file: csv, checksum },
        },
      );
      expect(response.status).toBe(201);
      expect(memberImportResultSchema.parse(await response.json())).toEqual({
        added: 3,
        restored: 0,
        joined: 0,
        skippedExisting: 0,
        skippedInvalid: 0,
      });
    });

    it('answers 422 for a body that is not a file at all', async () => {
      const response = await call(
        previewRoute,
        'POST',
        `/api/v1/clubs/${s.clubA.id}/members/import/preview`,
        { actor: s.users.officerA.uniEmail, clubId: s.clubA.id, body: { file: '' } },
      );
      expect(response.status).toBe(422);
      const error = await envelope(response);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.issues?.[0]?.path).toEqual(['body', 'file']);
    });
  });

  describe('the template', () => {
    it('downloads as a CSV file with a BOM, so Excel opens the Arabic headers', async () => {
      const response = await endpoints.template(s.clubA.id, s.users.officerA.uniEmail);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toContain('attachment');

      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

      const text = bytes.toString('utf8');
      expect(text.endsWith('\r\n')).toBe(true);
      // Every column, under the label the import matches first.
      for (const [arabic] of Object.values(memberImportColumns)) {
        expect(text).toContain(arabic);
      }
      expect(text.split('\r\n').filter(Boolean)).toHaveLength(1);
    });
  });

  /** The same three endpoints for one committee (docs/adr/0029-leads-add-members.md). */
  describe('for one committee', () => {
    const file = () =>
      importFile(['الاسم الكامل,البريد الجامعي', 'طالب للجنة,s441003101@uqu.edu.sa'].join('\n'));
    const at = (
      route: Route,
      method: 'GET' | 'POST',
      committeeId: string,
      path: string,
      actor?: string,
      body?: unknown,
    ) =>
      callRoute(route, {
        method,
        path: `/api/v1/committees/${committeeId}/members/import${path}`,
        params: { committeeId },
        actor,
        body,
      });

    it('previews, imports and serves the template for the committee’s lead', async () => {
      const lead = s.users.leadA1.uniEmail;
      const preview = await at(
        committeePreviewRoute,
        'POST',
        s.committees.a1.id,
        '/preview',
        lead,
        {
          file: file(),
        },
      );
      expect(preview.status).toBe(200);
      const body = previewMemberImportResponseSchema.parse(await preview.json());
      expect(body.notices).toEqual([]);

      const imported = await at(committeeImportRoute, 'POST', s.committees.a1.id, '', lead, {
        file: file(),
        checksum: body.checksum,
      });
      expect(imported.status).toBe(201);
      expect(memberImportResultSchema.parse(await imported.json())).toMatchObject({ added: 1 });

      const template = await at(
        committeeTemplateRoute,
        'GET',
        s.committees.a1.id,
        '/template',
        lead,
      );
      expect(template.status).toBe(200);
      expect(template.headers.get('content-type')).toContain('text/csv');
    });

    it('is a 404 for another committee and 401 signed out', async () => {
      const other = await at(
        committeePreviewRoute,
        'POST',
        s.committees.a2.id,
        '/preview',
        s.users.leadA1.uniEmail,
        {
          file: file(),
        },
      );
      expect(other.status).toBe(404);
      const anonymous = await at(
        committeePreviewRoute,
        'POST',
        s.committees.a1.id,
        '/preview',
        undefined,
        {
          file: file(),
        },
      );
      expect(anonymous.status).toBe(401);
    });
  });
});
