import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { resolveActor } from '@/server/actor';
import { AuthzError, type Actor } from '@/server/authz';
import { env } from '@/server/env';
import { ConflictError, NotFoundError, RateLimitedError } from '@/server/errors';
import { defineEndpoint, queryInt, type ErrorEnvelope } from '@/shared/contracts/core';

import { defineRoute, withFile, withSession, withStatus, type ClientInfo } from '../route';

vi.mock('@/server/actor', () => ({ resolveActor: vi.fn() }));
vi.mock('@/server/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const actor: Actor = { userId: 'user-1', isFullAdmin: false, memberships: [] };
const ID = '0192d000-0000-7000-8000-000000000001';

const itemEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/items/:id',
  access: 'actor',
  params: z.object({ id: z.uuid() }),
  query: z.object({ page: queryInt({ min: 1, max: 10 }).default(1) }),
  body: z.object({ name: z.string().min(2) }),
  response: z.object({ id: z.string(), name: z.string() }),
});

const sameOrigin: Record<string, string> = {
  origin: env.APP_ORIGIN,
  'content-type': 'application/json',
};

function call(
  handler: ReturnType<typeof defineRoute>,
  {
    url = `http://localhost/api/v1/items/${ID}`,
    body = '{"name":"ok"}',
    id = ID,
    method = 'POST',
    headers = sameOrigin,
  } = {},
) {
  const request = new NextRequest(url, { method, body, headers });
  return handler(request, { params: Promise.resolve({ id }) });
}

async function envelope(response: Response): Promise<ErrorEnvelope['error']> {
  return ((await response.json()) as ErrorEnvelope).error;
}

describe('defineRoute', () => {
  beforeEach(() => {
    vi.mocked(resolveActor).mockResolvedValue({ actor, cookies: [] });
  });

  it('passes the actor and parsed input to the handler, and strips unknown response fields', async () => {
    const handler = vi.fn(async ({ actor: who, params, query, body }) => ({
      id: params.id,
      name: `${body.name}:${query.page}:${who.userId}`,
      phone: '+966500000000', // not in the contract → must not leave the server
    }));
    const response = await call(defineRoute(itemEndpoint, handler), {
      url: `http://localhost/api/v1/items/${ID}?page=3`,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ id: ID, name: 'ok:3:user-1' });
  });

  it('answers 401 when the endpoint needs an actor and there is none', async () => {
    vi.mocked(resolveActor).mockResolvedValue({ actor: null, cookies: [] });
    const response = await call(defineRoute(itemEndpoint, async () => ({ id: '', name: '' })));
    expect(response.status).toBe(401);
    expect((await envelope(response)).code).toBe('UNAUTHENTICATED');
  });

  it('answers 422 with located issues for invalid input', async () => {
    const response = await call(
      defineRoute(itemEndpoint, async () => ({ id: '', name: '' })),
      {
        id: 'not-a-uuid',
        body: '{"name":"x"}',
      },
    );
    expect(response.status).toBe(422);
    const error = await envelope(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.issues?.map((issue) => issue.path[0])).toEqual(['params']);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await call(
      defineRoute(itemEndpoint, async () => ({ id: '', name: '' })),
      {
        body: '{not json',
      },
    );
    expect(response.status).toBe(400);
  });

  it.each([
    [new AuthzError('club_management_required'), 403, 'FORBIDDEN', 'club_management_required'],
    [new NotFoundError('Member'), 404, 'NOT_FOUND', undefined],
    [
      new ConflictError('Already cancelled.', 'transaction_cancelled'),
      409,
      'CONFLICT',
      'transaction_cancelled',
    ],
  ])('maps %s to %i', async (thrown, status, code, reason) => {
    const response = await call(
      defineRoute(itemEndpoint, async () => {
        throw thrown;
      }),
    );
    expect(response.status).toBe(status);
    const error = await envelope(response);
    expect(error.code).toBe(code);
    expect(error.reason).toBe(reason);
    expect(error.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('hides unexpected errors behind a 500 envelope', async () => {
    const response = await call(
      defineRoute(itemEndpoint, async () => {
        throw new Error('database password is hunter2');
      }),
    );
    expect(response.status).toBe(500);
    const error = await envelope(response);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).not.toContain('hunter2');
  });

  it('treats a handler result that breaks the contract as a server error', async () => {
    // @ts-expect-error -- deliberately returns the wrong shape
    const response = await call(defineRoute(itemEndpoint, async () => ({ id: 1 })));
    expect(response.status).toBe(500);
  });

  it('supports 204 responses and status overrides', async () => {
    const deleteEndpoint = defineEndpoint({
      method: 'DELETE',
      path: '/api/v1/items/:id',
      access: 'actor',
      params: z.object({ id: z.uuid() }),
      response: null,
    });
    const noContent = await call(
      defineRoute(deleteEndpoint, async () => undefined),
      { body: '', method: 'DELETE', headers: { origin: env.APP_ORIGIN } },
    );
    expect(noContent.status).toBe(204);

    const healthEndpoint = defineEndpoint({
      method: 'GET',
      path: '/api/v1/ping',
      access: 'public',
      response: z.object({ ok: z.boolean() }),
    });
    const handler = defineRoute(healthEndpoint, async () => withStatus(503, { ok: false }));
    const response = await handler(new NextRequest('http://localhost/api/v1/ping'), {
      params: Promise.resolve({}),
    });
    expect(response.status).toBe(503);
  });

  it('never resolves an actor for public endpoints', async () => {
    vi.mocked(resolveActor).mockClear();
    const publicEndpoint = defineEndpoint({
      method: 'GET',
      path: '/api/v1/public/ping',
      access: 'public',
      response: z.object({ actor: z.null() }),
    });
    const handler = defineRoute(publicEndpoint, async ({ actor: who }) => ({ actor: who }));
    const response = await handler(new NextRequest('http://localhost/api/v1/public/ping'), {
      params: Promise.resolve({}),
    });
    expect(await response.json()).toEqual({ actor: null });
    expect(resolveActor).not.toHaveBeenCalled();
  });

  describe('CSRF checks', () => {
    const ok = async () => ({ id: '', name: '' });

    it.each([
      ['a foreign Origin', { ...sameOrigin, origin: 'https://evil.example' }],
      ['no Origin', { 'content-type': 'application/json' }],
      ['an opaque Origin', { ...sameOrigin, origin: 'null' }],
    ])('refuses a POST with %s (403, handler not called)', async (_, headers) => {
      const handler = vi.fn(ok);
      const response = await call(defineRoute(itemEndpoint, handler), { headers });
      expect(response.status).toBe(403);
      expect(await envelope(response)).toMatchObject({
        code: 'FORBIDDEN',
        reason: 'cross_origin',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])(
      'refuses a body sent as "%s" (400, handler not called)',
      async (type) => {
        const handler = vi.fn(ok);
        const response = await call(defineRoute(itemEndpoint, handler), {
          headers: { origin: env.APP_ORIGIN, ...(type ? { 'content-type': type } : {}) },
        });
        expect(response.status).toBe(400);
        expect((await envelope(response)).reason).toBe('json_required');
        expect(handler).not.toHaveBeenCalled();
      },
    );

    it('accepts JSON with a charset, and GET requests without an Origin', async () => {
      const post = await call(defineRoute(itemEndpoint, ok), {
        headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json; charset=utf-8' },
      });
      expect(post.status).toBe(200);

      const getEndpoint = defineEndpoint({
        method: 'GET',
        path: '/api/v1/ping',
        access: 'public',
        response: z.object({ ok: z.boolean() }),
      });
      const get = await defineRoute(getEndpoint, async () => ({ ok: true }))(
        new NextRequest('http://localhost/api/v1/ping'),
        { params: Promise.resolve({}) },
      );
      expect(get.status).toBe(200);
    });
  });

  it('answers 429 with Retry-After for rate limits', async () => {
    const response = await call(
      defineRoute(itemEndpoint, async () => {
        throw new RateLimitedError('resend_cooldown', 41.2);
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(await envelope(response)).toMatchObject({
      code: 'RATE_LIMITED',
      reason: 'resend_cooldown',
      retryAfterSeconds: 42,
    });
  });

  it('sets and clears the session cookie through withSession', async () => {
    const token = 'a'.repeat(43);
    const data = { id: '1', name: 'n' };
    const session = { token, expiresAt: new Date(Date.now() + 60_000) };

    const set = await call(defineRoute(itemEndpoint, async () => withSession({ data, session })));
    expect(set.headers.get('set-cookie')).toMatch(
      new RegExp(`^dm-session=${token}; Path=/; Max-Age=(59|60); HttpOnly; SameSite=Lax$`),
    );

    const cleared = await call(
      defineRoute(itemEndpoint, async () => withSession({ data, session: null })),
    );
    expect(cleared.headers.get('set-cookie')).toBe(
      'dm-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    );
  });

  it('passes the session token and the trusted client IP to the handler', async () => {
    const token = 'b'.repeat(43);
    const seen: ClientInfo[] = [];
    await call(
      defineRoute(itemEndpoint, async ({ client }) => {
        seen.push(client);
        return { id: '', name: '' };
      }),
      { headers: { ...sameOrigin, cookie: `dm-session=${token}`, 'x-forwarded-for': '10.0.0.9' } },
    );
    // The unit project trusts no IP header (CLIENT_IP_HEADER defaults to none).
    expect(seen).toEqual([{ sessionToken: token, ip: null }]);
  });

  describe('body size', () => {
    const ok = async () => ({ id: '', name: '' });

    it('refuses a body larger than the limit, before the handler sees it', async () => {
      const handler = vi.fn(ok);
      const big = JSON.stringify({ name: 'x'.repeat(2_000_001) });
      const response = await call(defineRoute(itemEndpoint, handler), { body: big });
      expect(response.status).toBe(400);
      expect((await envelope(response)).reason).toBe('body_too_large');
      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses it on a declared content-length too, without reading the body', async () => {
      const handler = vi.fn(ok);
      const response = await call(defineRoute(itemEndpoint, handler), {
        headers: { ...sameOrigin, 'content-length': '9000000' },
      });
      expect(response.status).toBe(400);
      expect((await envelope(response)).reason).toBe('body_too_large');
      expect(handler).not.toHaveBeenCalled();
    });

    // A chunked request sends no content-length at all, so the only thing that can stop it is
    // measuring the stream while it is read. Reading it to the end first would let one request
    // buffer a body of any size (docs/reviews/2026-10-backend-review.md).
    it('refuses a streamed body with no content-length, without buffering all of it', async () => {
      const handler = vi.fn(ok);
      const megabyte = new Uint8Array(1_000_000).fill(0x61);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += megabyte.byteLength;
          // Far more than the cap: the chunks after the refusal must never be asked for.
          if (sent > 50_000_000) controller.close();
          else controller.enqueue(megabyte);
        },
      });
      const request = new NextRequest('http://localhost/api/v1/items/' + ID, {
        method: 'POST',
        headers: sameOrigin,
        body,
        // Required when the body is a stream.
        duplex: 'half',
      });

      const response = await defineRoute(itemEndpoint, handler)(request, {
        params: Promise.resolve({ id: ID }),
      });

      expect(response.status).toBe(400);
      expect((await envelope(response)).reason).toBe('body_too_large');
      expect(handler).not.toHaveBeenCalled();
      // A few megabytes, not the fifty the client offered: the reader stops pulling once the cap
      // is passed (the stream reads a chunk or two ahead, which is why this is not exactly 2 MB).
      expect(sent).toBeLessThanOrEqual(5_000_000);
    });

    it('still accepts a body the CSV import could really send', async () => {
      // 1 MB of CSV is about 1.33 MB of base64 — comfortably inside the limit.
      const response = await call(defineRoute(itemEndpoint, ok), {
        body: JSON.stringify({ name: 'a'.repeat(1_400_000) }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe('withFile', () => {
    const fileEndpoint = defineEndpoint({
      method: 'GET',
      path: '/api/v1/items/:id/file',
      access: 'actor',
      params: z.object({ id: z.uuid() }),
      response: z.string(),
    });

    const callFile = (handler: ReturnType<typeof defineRoute>) =>
      handler(new NextRequest(`http://localhost/api/v1/items/${ID}/file`), {
        params: Promise.resolve({ id: ID }),
      });

    it('sends the text as a download instead of JSON', async () => {
      const response = await callFile(
        defineRoute(fileEndpoint, async () =>
          withFile('a,b\r\n', { contentType: 'text/csv; charset=utf-8', filename: 'rows.csv' }),
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="rows.csv"');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('a,b\r\n');
    });

    it('still validates the text against the contract', async () => {
      const response = await callFile(
        defineRoute(fileEndpoint, async () =>
          // @ts-expect-error -- the contract says the response is text; a server bug is a 500.
          withFile(42, { contentType: 'text/csv', filename: 'rows.csv' }),
        ),
      );
      expect(response.status).toBe(500);
      expect((await envelope(response)).code).toBe('INTERNAL');
    });
  });
  /*
   * A public answer is about a named person and is reached by a token in the URL, so the URL must
   * not travel in a Referer header and the endpoint must not be indexed (ADR 0023). An endpoint
   * that needs an actor carries neither header: those answers are already behind a session.
   */
  describe('public endpoints', () => {
    const pingEndpoint = defineEndpoint({
      method: 'GET',
      path: '/api/v1/public/ping',
      access: 'public',
      response: z.object({ ok: z.boolean() }),
    });

    const ping = (handler: ReturnType<typeof defineRoute>) =>
      handler(new NextRequest('http://localhost/api/v1/public/ping'), {
        params: Promise.resolve({}),
      });

    it('answer with no-store, no-referrer and noindex', async () => {
      const response = await ping(defineRoute(pingEndpoint, async () => ({ ok: true })));

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('carry the same headers on a refusal, so a 404 is not indexed either', async () => {
      const response = await ping(
        defineRoute(pingEndpoint, () => Promise.reject(new NotFoundError('Page'))),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('are the only endpoints that carry them', async () => {
      const response = await call(defineRoute(itemEndpoint, async () => ({ id: ID, name: 'ok' })));

      expect(response.status).toBe(200);
      expect(response.headers.get('referrer-policy')).toBeNull();
      expect(response.headers.get('x-robots-tag')).toBeNull();
    });
  });
});
