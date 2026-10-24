import 'server-only';

export { getMe } from './service';
export {
  completeName,
  getSessionState,
  logout,
  requestOtp,
  resolveSessionActor,
  verifyOtp,
} from './sign-in';
/*
 * The auth module owns the `Session` table, so another module that must end a person's sessions
 * as part of its own write calls this with its transaction client — it never writes the table
 * itself (docs/adr/0017-member-permissions.md).
 */
export { endPersonSignIn, endUserSessions } from './repository';
