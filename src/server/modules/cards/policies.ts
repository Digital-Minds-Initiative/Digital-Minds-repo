import 'server-only';

import { AuthzError, ledCommitteeIds, canManageClub, type Actor } from '@/server/authz';
import { canAwardSticker, type AwarderStanding, type StickerKey } from '@/shared/lib/stickers';

/** What the actor is to a member's club and committees: the standing that decides what they may award. */
export function awarderStanding(
  actor: Actor,
  member: { clubId: string; committeeIds: readonly string[] },
): AwarderStanding {
  const led = new Set(ledCommitteeIds(actor));
  return {
    fullAdmin: actor.isFullAdmin,
    officer: canManageClub(actor, member.clubId),
    lead: member.committeeIds.some((id) => led.has(id)),
  };
}

/**
 * Awarding or taking back a sticker. Reaching this point means the member is in the actor's
 * scope, so a lead whose committee the member is not in never gets here (404 comes first); what is
 * left is a lead reaching for a sticker only officers give, or anyone awarding themselves.
 */
export function assertCanAward(
  actor: Actor,
  member: { userId: string; clubId: string; committeeIds: readonly string[] },
  key: StickerKey,
): void {
  const standing = awarderStanding(actor, member);
  if (!actor.isFullAdmin && actor.userId === member.userId) {
    throw new AuthzError('cannot_award_self');
  }
  if (!canAwardSticker(standing, key)) throw new AuthzError('sticker_award_not_allowed');
}
