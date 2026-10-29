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
import { env } from '@/server/env';
import {
  clubArchived,
  clubHasNoMembershipTypes,
  committeeArchived,
  NotFoundError,
} from '@/server/errors';
import type {
  MemberImportResult,
  PreviewMemberImportResponse,
} from '@/shared/contracts/members-import';

import { buildImportTemplate, decodeImportFile, parseImportFile } from './import-csv';
import {
  admissionTypeId,
  buildImportPlan,
  type ImportClubState,
  type ImportPlan,
  type ImportAdd,
  type ImportRestore,
} from './import-plan';
import {
  assertCanAddToCommittee,
  assertCanAdmitToCommittee,
  assertCanImportMembers,
} from './policies';
import {
  findAccountsByUniEmails,
  findActiveCommitteeIds,
  findClubForMembers,
  findCommitteeForMember,
  findCommitteesInClub,
  findMemberNames,
  findMembershipTypesInClub,
  importChanged,
  memberTypeMissing,
  saveImportedMembers,
  type ImportAddWrite,
  type ImportClient,
} from './repository';

/*
 * Importing members from a CSV file (docs/adr/0021-csv-member-import.md), into a whole club or
 * into one committee of it (docs/adr/0029-leads-add-members.md).
 *
 * Both steps do the same work: read the file, read what the club holds through the actor's
 * scopes, and build the plan. The preview answers with it and writes nothing; the import redoes
 * it inside the transaction that writes and goes ahead only if the checksum is still the one the
 * officer confirmed.
 *
 * Reading the file reveals nothing about anyone, so the order is the same as adding one member:
 * the club or committee must be visible (404), the actor must be allowed to import (403) and it
 * must be open (409) before a single address is looked up.
 */

/** Where a file goes: a club, or one committee of it. */
interface ImportTarget {
  clubId: string;
  committee: { id: string; name: string } | null;
}

/** What both steps of a club import need before they can look at the file. */
async function loadClub(actor: Actor, clubId: string): Promise<ImportTarget> {
  const club = await findClubForMembers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  assertCanImportMembers(actor, club.id);
  if (club.archived) throw clubArchived();
  return { clubId: club.id, committee: null };
}

/**
 * The same for a committee import: the committee through the actor's scope (another lead's is a
 * 404), the rule of adding one person to it, and both it and its club open.
 */
async function loadCommittee(actor: Actor, committeeId: string): Promise<ImportTarget> {
  const committee = await findCommitteeForMember(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanAdmitToCommittee(actor, { clubId: committee.clubId, committeeId: committee.id });
  if (committee.clubArchived) throw clubArchived();
  if (committee.archived) throw committeeArchived();
  return { clubId: committee.clubId, committee: { id: committee.id, name: committee.name } };
}

/**
 * Reads the file and says what importing it would do. Writes nothing — not even an account for
 * an address that has none.
 */
export async function previewMemberImport(
  actor: Actor,
  clubId: string,
  body: { file: string },
): Promise<PreviewMemberImportResponse> {
  return preview(actor, await loadClub(actor, clubId), body);
}

export async function previewCommitteeMemberImport(
  actor: Actor,
  committeeId: string,
  body: { file: string },
): Promise<PreviewMemberImportResponse> {
  return preview(actor, await loadCommittee(actor, committeeId), body);
}

async function preview(
  actor: Actor,
  target: ImportTarget,
  body: { file: string },
): Promise<PreviewMemberImportResponse> {
  const file = parseImportFile(decodeImportFile(body.file), {
    allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
  });
  const plan = await planFor(actor, target, file.rows);

  return {
    checksum: plan.checksum,
    ignoredColumns: file.ignoredColumns,
    notices: plan.notices,
    summary: plan.summary,
    rows: plan.rows,
  };
}

/**
 * Imports the file the preview described. `invalid` and `existing` rows are skipped, `join` rows
 * write only their committee memberships, and everything is written in one transaction, so a
 * failure anywhere leaves the club exactly as it was.
 *
 * The plan is built a second time inside that transaction and its checksum compared with the one
 * the client sends back. Anything that changed in between — a person added or removed by somebody
 * else, a committee renamed, a membership type deleted, an edited file — refuses the whole import
 * with 409 `import_changed` instead of saving something the officer never saw.
 */
export async function confirmMemberImport(
  actor: Actor,
  clubId: string,
  body: { file: string; checksum: string },
): Promise<MemberImportResult> {
  return confirm(actor, await loadClub(actor, clubId), body);
}

export async function confirmCommitteeMemberImport(
  actor: Actor,
  committeeId: string,
  body: { file: string; checksum: string },
): Promise<MemberImportResult> {
  return confirm(actor, await loadCommittee(actor, committeeId), body);
}

async function confirm(
  actor: Actor,
  target: ImportTarget,
  body: { file: string; checksum: string },
): Promise<MemberImportResult> {
  const file = parseImportFile(decodeImportFile(body.file), {
    allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
  });
  const plan = await planFor(actor, target, file.rows);
  if (plan.checksum !== body.checksum) throw importChanged();
  // A `join` row is adding an existing member to a committee, so it answers to that rule too.
  // Today it is the same rule as importing, so this never refuses — it keeps the two tied. A
  // committee import has already been held to the rule of adding to that committee.
  if (plan.joins.length > 0 && !target.committee) assertCanAddToCommittee(actor, target.clubId);

  await saveImportedMembers(
    {
      club: clubsScope(actor),
      committees: committeesScope(actor),
      // A committee import may bring in members the importer cannot read yet — someone removed,
      // or not in this committee — so it writes through the admission scope, while every
      // committee it writes into is still checked through `committeesScope`.
      members: target.committee ? memberAdmissionScope(actor) : membersScope(actor),
    },
    {
      clubId: target.clubId,
      adds: plan.adds.map(toAddWrite),
      restores: plan.restores.map(toRestore),
      joins: plan.joins.map(({ membershipId, committeeIds }) => ({ membershipId, committeeIds })),
    },
    async (tx) => (await planFor(actor, target, file.rows, tx)).checksum === body.checksum,
  );

  return {
    added: plan.adds.length,
    restored: plan.restores.length,
    joined: plan.joins.length,
    skippedExisting: plan.summary.existing,
    skippedInvalid: plan.summary.invalid,
  };
}

/** The template an officer fills in: the header row, and nothing else. */
export async function getMemberImportTemplate(actor: Actor, clubId: string): Promise<string> {
  await loadClub(actor, clubId);
  return buildImportTemplate();
}

export async function getCommitteeMemberImportTemplate(
  actor: Actor,
  committeeId: string,
): Promise<string> {
  await loadCommittee(actor, committeeId);
  return buildImportTemplate();
}

/**
 * The club's side of the plan, read through the actor's scopes — optionally on the transaction
 * that is about to write, so the confirm step compares against the state it will write into.
 */
async function planFor(
  actor: Actor,
  target: ImportTarget,
  rows: Parameters<typeof buildImportPlan>[0],
  client?: ImportClient,
): Promise<ImportPlan> {
  const { clubId } = target;
  // One query after another, never in parallel: inside the transaction these share a single
  // connection, and pg does not allow two queries on it at once.
  const membershipTypes = await findMembershipTypesInClub(
    membershipTypesScope(actor),
    clubId,
    client,
  );
  const committees = await findCommitteesInClub(committeesScope(actor), clubId, client);
  const defaultMembershipTypeId = target.committee
    ? admissionTypeId(membershipTypes)
    : (membershipTypes[0]?.id ?? null);
  if (!defaultMembershipTypeId) {
    throw target.committee ? memberTypeMissing() : clubHasNoMembershipTypes();
  }

  const uniEmails = [...new Set(rows.flatMap((row) => (row.uniEmail ? [row.uniEmail] : [])))];
  const accounts = await findAccountsByUniEmails(uniEmails, clubId, client);
  // Only the names of this club's own members, read through the members scope — or, for a
  // committee import, the admission scope, since a row may bring in a member the importer does
  // not see yet. Either way an account outside the club stays invisible, name included (ADR 0012).
  const storedNames = await findMemberNames(
    target.committee ? memberAdmissionScope(actor) : membersScope(actor),
    [...accounts.values()].flatMap((account) =>
      account.membership ? [account.membership.id] : [],
    ),
    client,
  );
  const activeCommittees = await findActiveCommitteeIds(
    committeeMembershipsScope(actor),
    [...accounts.values()].flatMap((account) =>
      account.membership && !account.membership.removed ? [account.membership.id] : [],
    ),
    client,
  );

  const club: ImportClubState = {
    clubId,
    defaultMembershipTypeId,
    committee: target.committee,
    membershipTypes,
    committees,
    accounts,
    storedNames,
    activeCommittees,
  };
  return buildImportPlan(rows, club);
}

function toAddWrite(add: ImportAdd): ImportAddWrite {
  return {
    uniEmail: add.uniEmail,
    fullName: add.fullName,
    userId: add.userId,
    membershipTypeId: add.membershipTypeId,
    profile: add.profile,
    committeeIds: add.committeeIds,
  };
}

function toRestore(restore: ImportRestore) {
  return {
    membershipId: restore.membershipId,
    membershipTypeId: restore.membershipTypeId,
    profile: restore.profile,
    committeeIds: restore.committeeIds,
  };
}
