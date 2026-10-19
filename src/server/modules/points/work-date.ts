import 'server-only';

import { ValidationError } from '@/server/errors';
import { isFutureDate } from '@/shared/lib/dates';

/**
 * A work date is a calendar date in Asia/Riyadh, today or earlier
 * (docs/adr/0019-points-rules.md). The contract field rejects a future one already; this is the
 * same rule for a caller that did not come through a contract — a script, or a service calling
 * another service — and it is here rather than in both points services so there is one of it.
 */
export function assertWorkDateNotInFuture(workDate: string): void {
  if (isFutureDate(workDate)) {
    throw new ValidationError([
      { path: ['body', 'workDate'], code: 'date_in_future', message: 'date_in_future' },
    ]);
  }
}
