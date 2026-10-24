import 'server-only';

import { after } from 'next/server';

/*
 * Work that must not hold up, or show in the timing of, the response — the invite-only sign-in
 * code email (docs/adr/0027-invite-only-sign-in.md). Next's `after()` keeps a serverless function
 * alive until the task finishes, so the send is not cut off when the response is out.
 *
 * Tests call services and route handlers outside a Next request, where `after()` throws. There
 * the task starts at once and is kept, so a test can wait for it with `settleAfterResponse()`.
 *
 * The task must handle its own errors: nothing is left to report them to once the response is
 * sent.
 */

const pending = new Set<Promise<void>>();

export function afterResponse(task: () => Promise<void>): void {
  if (process.env.NODE_ENV === 'test') {
    const running: Promise<void> = task().finally(() => pending.delete(running));
    pending.add(running);
    return;
  }
  after(task);
}

/** For tests: waits until every task started by `afterResponse` has finished. */
export async function settleAfterResponse(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending);
}
