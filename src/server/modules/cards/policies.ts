import 'server-only';

import { AuthzError, canManageClub, ledCommitteeIds, type Actor } from '@/server/authz';
import {
  canAwardCustomSticker,
  canAwardSticker,
  type AwarderStanding,
  type StickerKey,
} from '@/shared/lib/stickers';

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

/** The same rules for a custom sticker, where its designer decided who may give it. */
export function assertCanAwardCustom(
  actor: Actor,
  member: { userId: string; clubId: string; committeeIds: readonly string[] },
  awardableBy: 'LEAD' | 'OFFICER',
): void {
  const standing = awarderStanding(actor, member);
  if (!actor.isFullAdmin && actor.userId === member.userId) {
    throw new AuthzError('cannot_award_self');
  }
  if (!canAwardCustomSticker(standing, awardableBy)) {
    throw new AuthzError('sticker_award_not_allowed');
  }
}

/** Whether the actor is a lead of any committee of the club: such a person may design stickers for it. */
function leadsInClub(actor: Actor, clubId: string): boolean {
  return actor.memberships.some(
    (membership) =>
      membership.clubId === clubId &&
      membership.committees.some((committee) => committee.role === 'LEAD'),
  );
}

/** Who may make a sticker for a club: its officers, full admins and the leads of its committees. */
export function canDesignStickers(actor: Actor, clubId: string): boolean {
  return actor.isFullAdmin || canManageClub(actor, clubId) || leadsInClub(actor, clubId);
}

/** Who may change a given sticker: officers and full admins any, a lead only the ones they made. */
export function canEditSticker(
  actor: Actor,
  sticker: { clubId: string; createdById: string },
): boolean {
  if (actor.isFullAdmin || canManageClub(actor, sticker.clubId)) return true;
  return sticker.createdById === actor.userId && leadsInClub(actor, sticker.clubId);
}

/**
 * Making a code for an event. Officers and full admins may for any sticker they can give; a lead
 * only for a committee they lead and a sticker that leads may give.
 */
export function assertCanCreateClaim(
  actor: Actor,
  clubId: string,
  committeeId: string | null,
  sticker: { allowedForLead: boolean },
): void {
  if (actor.isFullAdmin || canManageClub(actor, clubId)) return;
  const leads = committeeId !== null && ledCommitteeIds(actor).includes(committeeId);
  if (!leads || !sticker.allowedForLead) throw new AuthzError('sticker_claim_not_allowed');
}
