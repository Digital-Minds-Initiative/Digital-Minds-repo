import 'server-only';

import { AuthzError, canManageCommittee, type Actor, type CommitteeTarget } from '@/server/authz';

/**
 * Creating, editing and cancelling transactions in a committee: its lead, officers of its club,
 * full admins. Reading follows the same scope (pointTransactionsScope).
 */
export function assertCanWritePoints(actor: Actor, target: CommitteeTarget): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('points_management_required');
}
