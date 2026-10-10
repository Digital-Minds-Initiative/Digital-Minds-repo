import 'server-only';

import { AppError } from '@/server/errors';

/**
 * The actor can see the resource but their role does not allow this action (HTTP 403).
 *
 * For resources outside the actor's scope, throw NotFoundError instead: the scoped query simply
 * does not find them, and "not yours" must be indistinguishable from "does not exist".
 */
export class AuthzError extends AppError {
  readonly code = 'FORBIDDEN';

  constructor(reason: string, message = 'You are not allowed to do this.') {
    super(message, { reason });
  }
}
