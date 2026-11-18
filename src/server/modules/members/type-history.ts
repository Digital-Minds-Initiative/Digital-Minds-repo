import 'server-only';

import type { Actor, MemberAdmissionScope, MemberScope } from '@/server/authz';
import { recordMemberTypeChanges } from '@/server/modules/clubs';

import type { TypeChangeRecorder } from './repository';

/**
 * Records the type changes a member write made, as the actor, through the clubs module, which owns
 * the history (docs/adr/0031-membership-type-history.md). The scope is the one the write used.
 */
export function typeChangeRecorder(
  actor: Actor,
  scope: MemberScope | MemberAdmissionScope,
  source: 'EDIT' | 'RESTORE',
): TypeChangeRecorder {
  return (tx, changes) =>
    recordMemberTypeChanges(tx, scope, { changes, source, changedById: actor.userId });
}
