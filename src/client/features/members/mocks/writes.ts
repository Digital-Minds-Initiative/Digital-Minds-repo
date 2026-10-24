import {
  canManageClub,
  canSeeMembership,
  findMockActor,
  getMockDb,
  must,
  type MockActor,
  type MockDb,
  type MockMembership,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { deletePersonEndpoint } from '@/shared/contracts/deletions';
import {
  addMemberToCommitteeEndpoint,
  createMemberEndpoint,
  removeMemberEndpoint,
  removeMemberFromCommitteeEndpoint,
  updateMemberEndpoint,
} from '@/shared/contracts/members';
import { isAllowedEmailDomain } from '@/shared/lib/email-domains';
import { normalizePersonName } from '@/shared/lib/names';

import { toMemberFixture } from './fixtures';

/*
 * Mock member writes: adding a person, editing, removing, and moving between committees. The
 * rules and every refusal follow docs/adr/0017-member-permissions.md closely enough to build the
 * screens against (who may do what, `already_in_club` with the member's id, a removed membership
 * restored with its history and its roles reset); the server and its integration tests are the
 * real boundary.
 */

/** Matches ALLOWED_EMAIL_DOMAINS in .env.example. */
const MOCK_EMAIL_DOMAINS = ['uqu.edu.sa'];

const conflict = (reason: string, details?: Record<string, string>) =>
  mockError('CONFLICT', reason, { reason, ...(details ? { details } : {}) });
const forbidden = (reason: string) => mockError('FORBIDDEN', reason, { reason });
const invalid = (path: string[], code: string) =>
  mockError('VALIDATION_FAILED', code, { issues: [{ path, code, message: code }] });

type Context = { db: MockDb; actor: MockActor };
const isError = (value: Context | MockError): value is MockError => 'code' in value;

function context(cookies: Record<string, string>): Context | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  return actor ? { db, actor } : mockError('UNAUTHENTICATED');
}

/** A member the actor can see, or the 404 the server gives for one it cannot. */
function loadMember({ db, actor }: Context, memberId: string): MockMembership | MockError {
  const membership = db.memberships.find((candidate) => candidate.id === memberId);
  return membership && canSeeMembership(actor, membership) ? membership : mockError('NOT_FOUND');
}

const failed = <T extends object>(value: T | MockError): value is MockError => 'code' in value;

const requireClubManagement = (actor: MockActor, clubId: string): MockError | null =>
  canManageClub(actor, clubId) ? null : forbidden('club_management_required');

/** A lead of one of the member's committees, who may change the membership type and nothing else. */
const leadsMemberCommittee = (actor: MockActor, membership: MockMembership) =>
  membership.committees.some((c) => !c.removed && actor.ledCommitteeIds.includes(c.committeeId));

export const memberWriteHandlers = [
  mockEndpoint(createMemberEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const club = db.clubsById.get(params.clubId);
    const sees =
      club &&
      (canManageClub(actor, club.id) ||
        actor.ledCommitteeIds.some((id) => db.committeesById.get(id)?.clubId === club.id));
    if (!club || !sees) return mockError('NOT_FOUND');
    const denied = requireClubManagement(actor, club.id);
    if (denied) return denied;
    if (club.archivedAt) return conflict('club_archived');
    if (!isAllowedEmailDomain(body.person.uniEmail, MOCK_EMAIL_DOMAINS)) {
      return invalid(['body', 'person', 'uniEmail'], 'email_domain_not_allowed');
    }

    const types = db.membershipTypes
      .filter((type) => type.clubId === club.id)
      .sort((a, b) => a.order - b.order);
    const type = body.membershipTypeId
      ? types.find((candidate) => candidate.id === body.membershipTypeId)
      : types[0];
    if (!type) return invalid(['body', 'membershipTypeId'], 'membership_type_not_in_club');
    const committees = [];
    for (const committeeId of body.committeeIds) {
      const committee = db.committeesById.get(committeeId);
      if (!committee || committee.clubId !== club.id) {
        return invalid(['body', 'committeeIds'], 'committee_not_in_club');
      }
      if (committee.archivedAt) return conflict('committee_archived');
      committees.push(committee);
    }

    // The same address is the same person: an existing account is linked and keeps its name.
    let user = db.users.find((candidate) => candidate.uniEmail === body.person.uniEmail);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        key: body.person.uniEmail,
        publicId: crypto.randomUUID().replaceAll('-', ''),
        fullName: normalizePersonName(body.person.fullName),
        uniEmail: body.person.uniEmail,
        isFullAdmin: false,
        registered: false,
        persona: 'unregistered',
      };
      db.users.push(user);
      db.usersById.set(user.id, user);
    }
    const profile = {
      personalEmail: body.profile.personalEmail ?? null,
      phone: body.profile.phone ?? null,
      college: body.profile.college ?? null,
      major: body.profile.major ?? null,
      level: body.profile.level ?? null,
    };

    const existing = db.memberships.find(
      (membership) => membership.userId === user.id && membership.clubId === club.id,
    );
    let membership: MockMembership;
    if (existing && existing.removedAt === null) {
      return conflict('already_in_club', { memberId: existing.id });
    }
    if (existing) {
      // A removed membership comes back as the same row, so its committees and points return with
      // it; the roles are reset so nobody regains rights by being added again.
      membership = existing;
      membership.removedAt = null;
      membership.role = 'MEMBER';
      membership.typeId = type.id;
      membership.profile = profile;
      for (const link of membership.committees) link.role = 'MEMBER';
    } else {
      membership = {
        id: crypto.randomUUID(),
        userId: user.id,
        clubId: club.id,
        typeId: type.id,
        role: 'MEMBER',
        profile,
        joinedAt: new Date().toISOString(),
        removedAt: null,
        committees: [],
      };
      db.memberships.push(membership);
    }
    for (const committee of committees) {
      const link = membership.committees.find((c) => c.committeeId === committee.id);
      if (link) {
        link.removed = false;
        link.role = 'MEMBER';
      } else {
        membership.committees.push({ committeeId: committee.id, role: 'MEMBER', removed: false });
      }
    }
    return toMemberFixture(db, actor, membership);
  }),

  mockEndpoint(updateMemberEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = loadMember(ctx, params.memberId);
    if (failed(membership)) return membership;
    if (membership.removedAt !== null) return conflict('member_removed');
    const user = must(db.usersById.get(membership.userId), 'user');
    const manages = canManageClub(actor, membership.clubId);

    const next = {
      uniEmail:
        body.uniEmail !== undefined && body.uniEmail !== user.uniEmail ? body.uniEmail : undefined,
      fullName:
        body.fullName !== undefined && normalizePersonName(body.fullName) !== user.fullName
          ? normalizePersonName(body.fullName)
          : undefined,
    };
    const profileKeys = ['personalEmail', 'phone', 'college', 'major', 'level'] as const;
    const profileChanges = profileKeys.filter(
      (key) => body[key] !== undefined && body[key] !== membership.profile[key],
    );

    // Each group of fields is checked on its own, and a field the person may not change is refused
    // by name — but only when it would really change something.
    if (next.uniEmail !== undefined) {
      if (!actor.user.isFullAdmin) {
        const denied = requireClubManagement(actor, membership.clubId);
        if (denied) return denied;
        if (user.registered) return forbidden('uni_email_requires_full_admin');
      }
    }
    if (next.fullName !== undefined || profileChanges.length > 0) {
      const denied = requireClubManagement(actor, membership.clubId);
      if (denied) return denied;
    }
    const typeChange =
      body.membershipTypeId !== undefined && body.membershipTypeId !== membership.typeId
        ? body.membershipTypeId
        : undefined;
    if (typeChange !== undefined) {
      if (!manages && !leadsMemberCommittee(actor, membership)) {
        return forbidden('membership_type_change_not_allowed');
      }
      const target = db.membershipTypesById.get(typeChange);
      if (!target || target.clubId !== membership.clubId) {
        return invalid(['body', 'membershipTypeId'], 'membership_type_not_in_club');
      }
    }
    if (next.uniEmail !== undefined) {
      if (!isAllowedEmailDomain(next.uniEmail, MOCK_EMAIL_DOMAINS)) {
        return invalid(['body', 'uniEmail'], 'email_domain_not_allowed');
      }
      if (db.users.some((other) => other.id !== user.id && other.uniEmail === next.uniEmail)) {
        return conflict('already_exists');
      }
      user.uniEmail = next.uniEmail;
    }
    if (next.fullName !== undefined) user.fullName = next.fullName;
    for (const key of profileChanges) {
      const value = body[key];
      if (value === undefined) continue;
      Object.assign(membership.profile, { [key]: value });
    }
    if (typeChange !== undefined) membership.typeId = typeChange;
    return toMemberFixture(db, actor, membership);
  }),

  mockEndpoint(removeMemberEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const membership = loadMember(ctx, params.memberId);
    if (failed(membership)) return membership;
    const denied = requireClubManagement(ctx.actor, membership.clubId);
    if (denied) return denied;
    // Idempotent: the soft removal also ends the committee memberships and resets every role.
    if (membership.removedAt === null) {
      membership.removedAt = new Date().toISOString();
      membership.role = 'MEMBER';
      for (const link of membership.committees) {
        link.removed = true;
        link.role = 'MEMBER';
      }
    }
    return undefined;
  }),

  mockEndpoint(addMemberToCommitteeEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = loadMember(ctx, params.memberId);
    if (failed(membership)) return membership;
    if (membership.removedAt !== null) return conflict('member_removed');
    const committee = db.committeesById.get(params.committeeId);
    if (
      !committee ||
      !(canManageClub(actor, committee.clubId) || actor.ledCommitteeIds.includes(committee.id))
    ) {
      return mockError('NOT_FOUND');
    }
    if (committee.clubId !== membership.clubId) {
      return invalid(['params', 'committeeId'], 'committee_not_in_club');
    }
    const denied = requireClubManagement(actor, committee.clubId);
    if (denied) return denied;
    if (db.clubsById.get(committee.clubId)?.archivedAt) return conflict('club_archived');
    if (committee.archivedAt) return conflict('committee_archived');

    const link = membership.committees.find((c) => c.committeeId === committee.id);
    if (!link) {
      membership.committees.push({ committeeId: committee.id, role: 'MEMBER', removed: false });
    } else if (link.removed) {
      // A removed committee membership comes back with its points, with its role reset.
      link.removed = false;
      link.role = 'MEMBER';
    }
    return toMemberFixture(db, actor, membership);
  }),

  mockEndpoint(removeMemberFromCommitteeEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = loadMember(ctx, params.memberId);
    if (failed(membership)) return membership;
    const committee = db.committeesById.get(params.committeeId);
    if (
      !committee ||
      !(canManageClub(actor, committee.clubId) || actor.ledCommitteeIds.includes(committee.id))
    ) {
      return mockError('NOT_FOUND');
    }
    const denied = requireClubManagement(actor, committee.clubId);
    if (denied) return denied;
    const link = membership.committees.find((c) => c.committeeId === committee.id);
    if (link && !link.removed) {
      link.removed = true;
      link.role = 'MEMBER';
    }
    return undefined;
  }),

  // A full admin deleting a person's data (ADR 0026): gone from every club, the account emptied,
  // what they recorded for others kept under a deleted author.
  mockEndpoint(deletePersonEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db, actor } = ctx;
    const membership = loadMember(ctx, params.memberId);
    if (failed(membership)) return membership;
    if (!actor.user.isFullAdmin) return forbidden('full_admin_required');
    const user = must(db.usersById.get(membership.userId), 'user');
    if (user.id === actor.user.id) return forbidden('cannot_delete_self');
    if (user.isFullAdmin) return forbidden('cannot_delete_full_admin');
    if (body.uniEmail.trim().toLowerCase() !== user.uniEmail) {
      return invalid(['body', 'uniEmail'], 'confirmation_mismatch');
    }

    const theirs = new Set(db.memberships.filter((m) => m.userId === user.id).map((m) => m.id));
    const transactions = db.transactions.filter((t) => theirs.has(t.membershipId));
    const counts = {
      memberships: theirs.size,
      committeeMemberships: db.memberships
        .filter((m) => theirs.has(m.id))
        .reduce((sum, m) => sum + m.committees.length, 0),
      pointTransactions: transactions.length,
      pointRevisions: transactions.reduce((sum, t) => sum + t.revisions.length, 0),
      pointBatches: 0,
      roleChanges: db.roleChanges.filter((c) => theirs.has(c.membershipId)).length,
      roleInvitations: 0,
      sessions: 0,
    };
    db.transactions.splice(
      0,
      db.transactions.length,
      ...db.transactions.filter((t) => !theirs.has(t.membershipId)),
    );
    db.roleChanges.splice(
      0,
      db.roleChanges.length,
      ...db.roleChanges.filter((c) => !theirs.has(c.membershipId)),
    );
    db.memberships.splice(
      0,
      db.memberships.length,
      ...db.memberships.filter((m) => !theirs.has(m.id)),
    );
    Object.assign(user, { fullName: '', uniEmail: '', registered: false, deleted: true });
    return counts;
  }),
];
