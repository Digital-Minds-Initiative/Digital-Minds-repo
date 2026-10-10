import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineEndpoint, queryInt, type ErrorEnvelope } from '@/lib/contracts';
import { resolveActor } from '@/server/actor';
import { AuthzError, type Actor } from '@/server/authz';
import { ConflictError, NotFoundError } from '@/server/errors';

import { defineRoute, withStatus } from './route';

vi.mock('@/server/actor', () => ({ resolveActor: vi.fn() }));
vi.mock('@/server/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

function call(
  handler: ReturnType<typeof defineRoute>,
  { url = `http://localhost/api/v1/items/${ID}`, body = '{"name":"ok"}', id = ID } = {},
) {
  const request = new NextRequest(url, { method: 'POST', body });
  return handler(request, { params: Promise.resolve({ id }) });
}

async function envelope(response: Response): Promise<ErrorEnvelope['error']> {
  return ((await response.json()) as ErrorEnvelope).error;
}

describe('defineRoute', () => {
  beforeEach(() => {
    vi.mocked(resolveActor).mockResolvedValue(actor);
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
    vi.mocked(resolveActor).mockResolvedValue(null);
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
      { body: '' },
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
});
