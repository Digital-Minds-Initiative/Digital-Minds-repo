import 'server-only';

import { committeesScope, type Actor } from '@/server/authz';
import { ConflictError, NotFoundError } from '@/server/errors';
import type { CommitteeViewLink } from '@/shared/contracts/clubs';

import { assertCanManageViewLink } from './policies';
import {
  findCommitteeViewLink,
  setCommitteeViewToken,
  type CommitteeViewLinkRow,
} from './repository';
import {
  decryptViewToken,
  encryptViewToken,
  generateViewToken,
  NO_VIEW_LINK,
  toViewLink,
  viewTokenHash,
} from './view-link-token';

/*
 * Managing a committee's public view link (docs/adr/0023-committee-view-link.md).
 *
 * The committee's lead, its club's officers and full admins may read the link, create it, renew
 * it and turn it off. A committee the actor cannot see is a 404 before anything else, as always.
 *
 * Reading works on an archived committee or club — an archived committee's page is closed, and
 * the lead should still be able to see which link used to be out there. Creating, renewing and
 * turning off are refused (409), like every other write to an archived club or committee.
 */

/** The committee's current link, or all nulls when it has none. */
export async function getCommitteeViewLink(
  actor: Actor,
  committeeId: string,
): Promise<CommitteeViewLink> {
  const committee = await loadCommitteeForViewLink(actor, committeeId);
  return storedLink(committee);
}

/**
 * Creates the link, or replaces it with a new one — one step, and the old link stops working as
 * soon as this returns, because the stored lookup key is the new token's.
 */
export async function rotateCommitteeViewLink(
  actor: Actor,
  committeeId: string,
): Promise<CommitteeViewLink> {
  const committee = await loadCommitteeForViewLink(actor, committeeId);
  assertNotArchived(committee);

  const token = generateViewToken();
  const createdAt = new Date();
  await setCommitteeViewToken(committeesScope(actor), committee.id, {
    hash: viewTokenHash(token),
    cipher: encryptViewToken(token, committee.id),
    createdAt,
  });
  return toViewLink(token, createdAt);
}

/** Turns the link off. Idempotent: a committee without one is already in the wanted state. */
export async function disableCommitteeViewLink(actor: Actor, committeeId: string): Promise<void> {
  const committee = await loadCommitteeForViewLink(actor, committeeId);
  assertNotArchived(committee);
  if (!committee.viewTokenHash) return;
  await setCommitteeViewToken(committeesScope(actor), committee.id, null);
}

async function loadCommitteeForViewLink(
  actor: Actor,
  committeeId: string,
): Promise<CommitteeViewLinkRow> {
  const committee = await findCommitteeViewLink(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanManageViewLink(actor, { clubId: committee.clubId, committeeId: committee.id });
  return committee;
}

/**
 * The stored link as the API answers it. A copy that cannot be decrypted (AUTH_SECRET was
 * rotated) is reported as no link at all, so the answer is never a token that does not work:
 * the officer creates a new one, which is what rotating the secret costs.
 */
function storedLink(committee: CommitteeViewLinkRow): CommitteeViewLink {
  if (!committee.viewTokenCipher || !committee.viewTokenCreatedAt) return NO_VIEW_LINK;
  const token = decryptViewToken(committee.viewTokenCipher, committee.id);
  return token ? toViewLink(token, committee.viewTokenCreatedAt) : NO_VIEW_LINK;
}

/** An archived club or committee accepts nothing new (ADR 0015), a view link included. */
function assertNotArchived(committee: CommitteeViewLinkRow): void {
  if (committee.club.archivedAt) {
    throw new ConflictError('The club is archived.', 'club_archived');
  }
  if (committee.archivedAt) {
    throw new ConflictError('The committee is archived.', 'committee_archived');
  }
}
