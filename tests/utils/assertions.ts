import { expect } from 'vitest';

import { AuthzError } from '@/server/authz';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';

/** Out of scope: must be indistinguishable from "does not exist". */
export async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(NotFoundError);
}

/** Visible, but the actor's role does not allow the action. */
export async function expectForbidden(promise: Promise<unknown>, reason?: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AuthzError);
  if (reason) expect((error as AuthzError).reason).toBe(reason);
}

export async function expectConflict(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConflictError);
  expect((error as ConflictError).reason).toBe(reason);
}

export async function expectInvalid(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as ValidationError).issues?.map((issue) => issue.code)).toContain(code);
}
