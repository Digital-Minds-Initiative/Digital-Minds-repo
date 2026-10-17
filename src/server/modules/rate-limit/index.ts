import 'server-only';

export { consumeFixedWindow } from './service';
/*
 * This module owns the `RateLimitCounter` table, so another module that sweeps its own expired
 * rows in one transaction calls this with that transaction's client.
 */
export { deleteExpiredCounters } from './repository';
