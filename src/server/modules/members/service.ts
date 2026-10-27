import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  memberAdmissionScope,
  membersScope,
  membershipTypesScope,
  type Actor,
} from '@/server/authz';
import { assertUniversityEmail } from '@/server/email-policy';
import {
  clubArchived,
  clubHasNoMembershipTypes,
  committeeArchived,
  committeeNotInClub,
  ConflictError,
  memberRemovedFromClub,
  membershipTypeNotInClub,
  NotFoundError,
} from '@/server/errors';
import { endUserSessions } from '@/server/modules/auth';
import { getActivePointsByMember, type MemberBalances } from '@/server/modules/points';
import { liveUniEmail } from '@/server/people';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import {
  type AdmitMemberBody,
  type CreateMemberBody,
  type ListMembersQuery,
  type ListMembersResponse,
  type Member,
  type MemberPointsBasis,
  type UpdateMemberBody,
} from '@/shared/contracts/members';
import { normalizeEmail } from '@/shared/lib/email-domains';
import { normalizePersonName } from '@/shared/lib/names';

import { admissionTypeId } from './import-plan';
import { toMember } from './mappers';
import {
  assertCanAddMember,
  assertCanAddToCommittee,
  assertCanAdmitToCommittee,
  assertCanChangeMembershipType,
  assertCanEditClubFields,
  assertCanEditFullName,
  assertCanEditUniEmail,
  assertCanRemoveFromClub,
  assertCanRemoveFromCommittee,
} from './policies';
import { rankByPoints } from './ranking';
import {
  addToCommittee,
  alreadyInClub,
  findAccountByUniEmail,
  findClubForMembers,
  findCommitteeForMember,
  findFilterClub,
  findFilterCommittee,
  findFilterMembershipTypes,
  findManageableCommittees,
  findMember,
  findMemberSortKeys,
  findMembershipTypesInClub,
  findMembersByIds,
  findMembersPage,
  memberTypeMissing,
  membershipTypeBelongsToClub,
  type MemberFilters,
  removeFromClub,
  removeFromCommittee,
  saveAdmittedMember,
  saveMemberChanges,
  saveNewMember,
  type MemberRow,
} from './repository';

/*
 * Members service. Every function takes the Actor first and reads through its scopes:
 *   - anything outside the scope → NotFoundError (404), even when addressed by id
 *   - visible, but the role does not allow the action → AuthzError (403)
 *
 * The rules themselves are in policies.ts and docs/adr/0017-member-permissions.md.
 */

/**
 * The members list. Every filter is resolved through its own scope first, so a filter can only
 * narrow what the actor already sees — and the answer says so: a club, committee or membership
 * type they cannot see is a 404, and one belonging to a different club than the rest of the
 * request implies is a 422 (docs/adr/0020-members-list-filtering.md).
 *
 * The points each row shows follow the filters: one committee's if one is filtered on, and only
 * the work-date period's if a period is. `pointsBasis` tells the caller which, so a column can
 * be labelled without guessing.
 */
export async function listMembers(
  actor: Actor,
  query: ListMembersQuery,
): Promise<ListMembersResponse> {
  const basis = await resolveListFilters(actor, query);
  const { items, total } = await findListedMembers(
    actor,
    toMemberFilters(query),
    query,
    basis,
    query,
  );
  return { items, ...pageMeta(total, query.page, query.pageSize), pointsBasis: basis };
}

/** The list's filters as the repository takes them. */
export function toMemberFilters(query: Omit<ListMembersQuery, 'page' | 'pageSize'>): MemberFilters {
  return {
    search: query.q,
    clubId: query.clubId,
    committeeId: query.committeeId,
    membershipTypeIds: query.membershipTypeId,
    role: query.role,
    registered: query.registered,
    status: query.status,
  };
}

/**
 * One page of the list, in its order, with the points the column shows. The members export reads
 * its rows through here too, so a file holds what the table would have shown, in the same order
 * (docs/adr/0025-members-export.md).
 */
export async function findListedMembers(
  actor: Actor,
  filters: MemberFilters,
  order: { sort: ListMembersQuery['sort']; order: 'asc' | 'desc'; from?: string; to?: string },
  basis: MemberPointsBasis,
  page: { page: number; pageSize: number },
): Promise<{ items: Member[]; total: number }> {
  const period = { from: order.from, to: order.to };
  const pointsIn = basis.committee?.id ?? null;

  const { rows, total } =
    order.sort === 'points'
      ? await pageByPoints(actor, filters, period, pointsIn, { ...page, order: order.order })
      : await pageByColumn(actor, filters, { sort: order.sort, order: order.order }, page);

  // Two queries for the whole page, whatever its size (docs/adr/0019-points-rules.md).
  const balances = await getActivePointsByMember(
    actor,
    rows.map((row) => row.id),
    period,
  );
  return { items: rows.map((row) => toMember(row, balances.get(row.id), pointsIn)), total };
}

/** Sorting by something the database can order: it counts, sorts and pages in two queries. */
async function pageByColumn(
  actor: Actor,
  filters: MemberFilters,
  order: { sort: Exclude<ListMembersQuery['sort'], 'points'>; order: 'asc' | 'desc' },
  page: { page: number; pageSize: number },
): Promise<{ rows: MemberRow[]; total: number }> {
  return findMembersPage(
    membersScope(actor),
    committeeMembershipsScope(actor),
    filters,
    order,
    pageOffset(page.page, page.pageSize),
  );
}

/**
 * Sorting by points. The figure is an aggregate two relations away and the `where` is a branded
 * scope, so the database cannot order by it without the authorization rules being rewritten as
 * SQL by hand — which is exactly what the branded scopes exist to prevent. Instead: read the id
 * and sort key of every match, sum their points, sort, and fetch the one page by id.
 *
 * Four queries whatever the page size, like the column path. It reads every matching member,
 * which is fine into the low thousands per filtered list and is the number ADR 0020 names as the
 * point to revisit it.
 */
async function pageByPoints(
  actor: Actor,
  filters: MemberFilters,
  period: { from?: string; to?: string },
  pointsIn: string | null,
  page: { page: number; pageSize: number; order: 'asc' | 'desc' },
): Promise<{ rows: MemberRow[]; total: number }> {
  const scope = membersScope(actor);
  const nested = committeeMembershipsScope(actor);
  const candidates = await findMemberSortKeys(scope, nested, filters);
  const balances = await getActivePointsByMember(
    actor,
    candidates.map((candidate) => candidate.id),
    period,
  );

  const ranked = rankByPoints(
    candidates.map((candidate) => ({
      ...candidate,
      // The figure being ranked is the one the column shows: with a committee filter, that
      // committee's share — not the member's total across every committee.
      points: pointsOf(balances.get(candidate.id), pointsIn),
    })),
    page.order,
  );

  const { skip, take } = pageOffset(page.page, page.pageSize);
  const pageIds = ranked.slice(skip, skip + take).map((candidate) => candidate.id);
  const rows = await findMembersByIds(scope, nested, pageIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows: pageIds.map((id) => byId.get(id)).filter((row): row is MemberRow => row !== undefined),
    total: ranked.length,
  };
}

/** The figure the list is showing: one committee's share, or every visible committee's total. */
function pointsOf(balances: MemberBalances | undefined, committeeId: string | null): number {
  if (!balances) return 0;
  return committeeId === null ? balances.total : (balances.byCommittee.get(committeeId) ?? 0);
}

/**
 * Checks each filter against its own scope and works out which club the request is about: the
 * one asked for, else the committee's, else the membership types'. Everything else must agree
 * with it.
 */
export async function resolveListFilters(
  actor: Actor,
  query: Pick<ListMembersQuery, 'clubId' | 'committeeId' | 'membershipTypeId' | 'from' | 'to'>,
): Promise<MemberPointsBasis> {
  const typeIds = query.membershipTypeId ?? [];
  const [club, committee, types] = await Promise.all([
    query.clubId === undefined ? null : findFilterClub(clubsScope(actor), query.clubId),
    query.committeeId === undefined
      ? null
      : findFilterCommittee(committeesScope(actor), query.committeeId),
    findFilterMembershipTypes(membershipTypesScope(actor), typeIds),
  ]);
  if (query.clubId !== undefined && !club) throw new NotFoundError('Club');
  if (query.committeeId !== undefined && !committee) throw new NotFoundError('Committee');
  if (types.length !== typeIds.length) throw new NotFoundError('Membership type');

  const clubId = club?.id ?? committee?.clubId ?? types[0]?.clubId ?? null;
  if (committee && committee.clubId !== clubId) {
    throw committeeNotInClub(['query', 'committeeId']);
  }
  if (types.some((type) => type.clubId !== clubId)) {
    throw membershipTypeNotInClub(['query', 'membershipTypeId']);
  }

  return {
    committee: committee ? { id: committee.id, name: committee.name } : null,
    from: query.from ?? null,
    to: query.to ?? null,
  };
}

export async function getMember(actor: Actor, memberId: string): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  const balances = await getActivePointsByMember(actor, [row.id]);
  return toMember(row, balances.get(row.id));
}

/**
 * Adds a person to a club, matched by university email: creates an unregistered account if the
 * email is new, links the existing account otherwise, and adds the requested committees. The
 * answer is the same either way, so it never reveals whether the account already existed.
 *
 * A membership this club removed earlier is restored with its history instead of a new one being
 * created; someone already active in the club is a 409 `already_in_club` carrying their member id
 * (the UI offers to open their profile), and nothing is written.
 */
export async function createMember(
  actor: Actor,
  clubId: string,
  body: CreateMemberBody,
): Promise<Member> {
  const club = await findClubForMembers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  if (club.archived) throw clubArchived();

  const committeeIds = [...new Set(body.committeeIds)];
  const committees = await findManageableCommittees(committeesScope(actor), club.id, committeeIds);
  if (committees.length !== committeeIds.length) throw new NotFoundError('Committee');
  if (committees.some((committee) => committee.archived)) {
    throw new ConflictError('One of the committees is archived.', 'committee_archived');
  }
  // The role check comes before the email is looked up, so a refusal never depends on who it is.
  assertCanAddMember(actor, club.id);

  const person = {
    uniEmail: normalizeEmail(body.person.uniEmail),
    fullName: normalizePersonName(body.person.fullName),
  };
  assertUniversityEmail(person.uniEmail, ['body', 'person', 'uniEmail']);
  // Unscoped on purpose: one account per person, so adding must find the existing one. It returns
  // ids only, and only a club's officers and full admins get here — they see every membership of
  // the club anyway, removed ones included. The restore itself still goes through their scope.
  const existing = await findAccountByUniEmail(person.uniEmail, club.id);
  if (existing?.membership && !existing.membership.removed) {
    throw alreadyInClub(existing.membership.id);
  }

  if (
    body.membershipTypeId !== undefined &&
    !(await membershipTypeBelongsToClub(club.id, body.membershipTypeId))
  ) {
    throw membershipTypeNotInClub();
  }
  const membershipTypeId = body.membershipTypeId ?? club.defaultMembershipTypeId;
  if (!membershipTypeId) throw clubHasNoMembershipTypes();

  const memberId = await saveNewMember(
    {
      club: clubsScope(actor),
      committees: committeesScope(actor),
      members: membersScope(actor),
    },
    {
      person,
      profile: body.profile,
      existing: existing ? { userId: existing.userId } : null,
      clubId: club.id,
      membershipTypeId,
      committeeIds,
    },
  );
  return getMember(actor, memberId);
}

/**
 * Brings a person into one committee (docs/adr/0029-leads-add-members.md): its leads may, as well
 * as the club's officers and full admins. New to the club or removed from it, they get the club's
 * «عضو» type; an active member only joins the committee and keeps everything else.
 *
 * The refusals come in the usual order, and all of them before the address is looked up, so none
 * depends on who the person is: a committee outside the actor's scope is a 404 (another lead's
 * committee included), then the role, then an archived club or committee and a club with no
 * «عضو» type.
 */
export async function admitMember(
  actor: Actor,
  committeeId: string,
  body: AdmitMemberBody,
): Promise<Member> {
  const committee = await findCommitteeForMember(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanAdmitToCommittee(actor, { clubId: committee.clubId, committeeId: committee.id });
  if (committee.clubArchived) throw clubArchived();
  if (committee.archived) throw committeeArchived();
  const membershipTypeId = await findAdmissionTypeId(actor, committee.clubId);

  const person = {
    uniEmail: normalizeEmail(body.person.uniEmail),
    fullName: normalizePersonName(body.person.fullName),
  };
  assertUniversityEmail(person.uniEmail, ['body', 'person', 'uniEmail']);

  const memberId = await saveAdmittedMember(
    {
      club: clubsScope(actor),
      committees: committeesScope(actor),
      admission: memberAdmissionScope(actor),
    },
    {
      person,
      profile: body.profile,
      clubId: committee.clubId,
      committeeId: committee.id,
      membershipTypeId,
    },
  );
  return getMember(actor, memberId);
}

/**
 * The club's «عضو» type, matched the way an import matches a type cell. A club that has none —
 * renamed, deleted, never created — cannot take members through a committee, and says so.
 */
async function findAdmissionTypeId(actor: Actor, clubId: string): Promise<string> {
  const types = await findMembershipTypesInClub(membershipTypesScope(actor), clubId);
  const typeId = admissionTypeId(types);
  if (!typeId) throw memberTypeMissing();
  return typeId;
}

/**
 * The name and university email are shared by the person's clubs; everything else is this club's.
 *
 * Each group of fields is checked against its own rule, in the order below, and a field the actor
 * may not change is a 403 — never silently dropped. Unknown fields never get here: the contract
 * body is strict, so the route wrapper answers 422.
 */
export async function updateMember(
  actor: Actor,
  memberId: string,
  body: UpdateMemberBody,
): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  if (row.removedAt) throw memberRemovedFromClub();
  const member = {
    clubId: row.club.id,
    committeeIds: row.committeeMemberships.map((membership) => membership.committee.id),
  };

  // The services normalise what they store too, so a direct call (a script, the CSV import)
  // cannot write a spelling the contract would have rejected — an address that is not lower-case
  // would fail the CHECK constraint on User.uniEmail.
  const changes = {
    uniEmail: changed(
      body.uniEmail === undefined ? undefined : normalizeEmail(body.uniEmail),
      liveUniEmail(row.user.uniEmail),
    ),
    fullName: changed(
      body.fullName === undefined ? undefined : normalizePersonName(body.fullName),
      row.user.fullName,
    ),
    personalEmail: changed(body.personalEmail, row.personalEmail),
    phone: changed(body.phone, row.phone),
    college: changed(body.college, row.college),
    major: changed(body.major, row.major),
    level: changed(body.level, row.level),
    membershipTypeId: changed(body.membershipTypeId, row.membershipType.id),
  };
  const { uniEmail, fullName, membershipTypeId, ...clubFields } = changes;
  const isRegistered = row.user.registeredAt !== null;

  // Only a real change is a change: a form that posts every field must not be refused over the
  // ones it is leaving as they are.
  if (uniEmail !== undefined) {
    assertCanEditUniEmail(actor, { clubId: member.clubId, isRegistered });
  }
  if (fullName !== undefined) assertCanEditFullName(actor, member.clubId);
  if (Object.values(clubFields).some((value) => value !== undefined)) {
    assertCanEditClubFields(actor, member.clubId);
  }
  if (membershipTypeId !== undefined) {
    assertCanChangeMembershipType(actor, member);
    if (!(await membershipTypeBelongsToClub(member.clubId, membershipTypeId))) {
      throw membershipTypeNotInClub();
    }
  }
  // Which domains are allowed is configuration, so the server checks it, not the contract. An
  // address already used by someone else is caught by the unique constraint (409 already_exists).
  if (uniEmail !== undefined) assertUniversityEmail(uniEmail);

  // Nothing really changes: answer with the member rather than open a transaction that would
  // write nothing.
  if (Object.values(changes).some((value) => value !== undefined)) {
    await saveMemberChanges(
      membersScope(actor),
      memberId,
      changes,
      // Moving the account to another address invalidates what the person signed in with, so
      // every session of theirs ends with the change, not after it — including a sign-in that is
      // half-done (an unregistered person waiting on the name step holds a session too).
      uniEmail !== undefined ? (tx) => endUserSessions(tx, row.user.id) : undefined,
    );
  }
  return getMember(actor, memberId);
}

/**
 * The submitted value, or undefined when the field was not sent or already holds it. Comparison
 * is on the normalised value, so a differently spaced name or a capitalised address is the same
 * value, not an edit.
 */
function changed<T>(submitted: T | undefined, stored: T): T | undefined {
  return submitted === undefined || submitted === stored ? undefined : submitted;
}

/** Removes the person from this club only. Idempotent. */
export async function removeMember(actor: Actor, memberId: string): Promise<void> {
  const row = await loadVisibleMember(actor, memberId);
  assertCanRemoveFromClub(actor, row.club.id);
  if (row.removedAt) return;
  await removeFromClub(membersScope(actor), memberId, actor.userId);
}

export async function addMemberToCommittee(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  if (row.removedAt) throw memberRemovedFromClub();
  const committee = await findCommitteeForMember(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  if (committee.clubId !== row.club.id) throw committeeNotInClub();
  assertCanAddToCommittee(actor, committee.clubId);
  if (committee.clubArchived) throw clubArchived();
  if (committee.archived) throw committeeArchived();

  await addToCommittee(
    { members: membersScope(actor), committees: committeesScope(actor) },
    {
      memberId,
      clubId: committee.clubId,
      committeeId: committee.id,
    },
  );
  return getMember(actor, memberId);
}

export async function removeMemberFromCommittee(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<void> {
  const row = await loadVisibleMember(actor, memberId);
  // The member's committee list only contains committees the actor can see.
  const committeeMembership = row.committeeMemberships.find(
    (membership) => membership.committee.id === committeeId,
  );
  if (!committeeMembership) throw new NotFoundError('Committee member');

  assertCanRemoveFromCommittee(actor, row.club.id);
  await removeFromCommittee(committeeMembershipsScope(actor), { memberId, committeeId });
}

async function loadVisibleMember(actor: Actor, memberId: string): Promise<MemberRow> {
  const row = await findMember(membersScope(actor), committeeMembershipsScope(actor), memberId);
  if (!row) throw new NotFoundError('Member');
  return row;
}
