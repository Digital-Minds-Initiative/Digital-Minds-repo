/*
 * AUTH_SELF_SIGNUP decides whether anyone with a university address can create an account by
 * signing in, or only people who were given a role (docs/adr/0027-invite-only-sign-in.md).
 *
 * The server validates the variable at startup (src/server/env.ts), and a production server
 * refuses to start without it. Pages read it through `selfSignupEnabled()` while they render —
 * at request time, never baked into a build — to decide whether to offer «إنشاء حساب».
 */

/** The variable's value as a flag. Unset means on: only development and tests can leave it unset. */
export function parseSelfSignup(value: string | undefined): boolean {
  return value !== 'false';
}

/**
 * For server components. Every page renders per request (the root layout reads the CSP nonce), so
 * this reads the running server's environment. A client component would read `undefined` here —
 * pass the value down as a prop instead.
 */
export function selfSignupEnabled(): boolean {
  return parseSelfSignup(process.env.AUTH_SELF_SIGNUP);
}
