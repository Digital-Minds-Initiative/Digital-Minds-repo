import 'server-only';

import { createHash } from 'node:crypto';

import type {
  MemberImportIssue,
  MemberImportRow,
  MemberImportStatus,
  MemberImportSummary,
} from '@/shared/contracts/members-import';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { normalizeEntityName } from '@/shared/lib/names';

import type { ParsedImportRow } from './import-csv';

/*
 * The club half of the import: parsed rows + what the club currently holds → what each row would
 * do, what the officer is shown, and the checksum that ties the two steps together
 * (docs/adr/0021-csv-member-import.md).
 *
 * Nothing here touches the database. The import runs it twice — once for the preview and once
 * inside the transaction that writes — and compares the checksums, which is the whole guarantee
 * that an officer cannot confirm something other than what they saw.
 */

/** This club's copy of the person's details, as a row provides it. */
type ImportProfile = ParsedImportRow['profile'];

/** What the club holds, read through the actor's scopes before the plan is built. */
export interface ImportClubState {
  clubId: string;
  /** Used by rows that name no type: the club's first type by order. */
  defaultMembershipTypeId: string;
  membershipTypes: ReadonlyArray<{ id: string; name: string }>;
  committees: ReadonlyArray<{ id: string; name: string; archived: boolean }>;
  /**
   * Accounts for the file's addresses: ids only, deliberately including accounts that exist
   * outside this club — adding has to link to them (one account per person) and must not say so.
   */
  accounts: ReadonlyMap<
    string,
    { userId: string; membership: { id: string; removed: boolean } | null }
  >;
  /** The name this club has on record, per membership id. Read through the members scope. */
  storedNames: ReadonlyMap<string, string>;
}

/** An `add` row: create the account unless it exists, then create the membership. */
export interface ImportAdd {
  line: number;
  uniEmail: string;
  /** Written only when the account is created; an existing account keeps its own name. */
  fullName: string;
  userId: string | null;
  membershipTypeId: string;
  profile: ImportProfile;
  committeeIds: string[];
}

/** A `restore` row: the removed membership comes back with its id, and so with its points. */
export interface ImportRestore {
  line: number;
  membershipId: string;
  membershipTypeId: string;
  profile: ImportProfile;
  committeeIds: string[];
}

export interface ImportPlan {
  /** Exactly what the preview answers with, in file order. */
  rows: MemberImportRow[];
  summary: MemberImportSummary;
  checksum: string;
  adds: ImportAdd[];
  restores: ImportRestore[];
}

export function buildImportPlan(rows: ParsedImportRow[], club: ImportClubState): ImportPlan {
  const plan: ImportPlan = {
    rows: [],
    summary: { total: rows.length, add: 0, restore: 0, existing: 0, invalid: 0 },
    checksum: '',
    adds: [],
    restores: [],
  };
  /** First line each address was used on, so a repeat can point at it. */
  const firstSeen = new Map<string, number>();

  for (const row of rows) {
    const classified = classify(row, club, firstSeen);
    plan.rows.push(classified.row);
    plan.summary[classified.row.status] += 1;
    if (classified.add) plan.adds.push(classified.add);
    if (classified.restore) plan.restores.push(classified.restore);
    if (row.uniEmail && !firstSeen.has(row.uniEmail)) firstSeen.set(row.uniEmail, row.line);
  }

  plan.checksum = checksumOf(plan, club.clubId);
  return plan;
}

interface ClassifiedRow {
  row: MemberImportRow;
  add?: ImportAdd;
  restore?: ImportRestore;
}

function classify(
  parsed: ParsedImportRow,
  club: ImportClubState,
  firstSeen: ReadonlyMap<string, number>,
): ClassifiedRow {
  const issues = [...parsed.issues];
  const warnings: MemberImportIssue[] = [];

  // The same address twice in one file: the first row is imported, every later one is refused and
  // says where its twin is, so the officer fixes the file once.
  const duplicateOf = parsed.uniEmail === null ? undefined : firstSeen.get(parsed.uniEmail);
  if (duplicateOf !== undefined) {
    issues.push({ field: 'uniEmail', code: 'duplicate_in_file', at: duplicateOf });
  }

  const membershipTypeId = resolveMembershipType(parsed, club, issues);
  const committeeIds = resolveCommittees(parsed, club, issues);

  const account = parsed.uniEmail === null ? undefined : club.accounts.get(parsed.uniEmail);
  const membership = account?.membership ?? null;
  // A member of this club is visible to the importing officer, so their stored name can be shown
  // and compared. An account outside the club is not: `add` rows show the file's name and say
  // nothing, exactly as adding one member does (ADR 0012).
  const storedName = membership ? (club.storedNames.get(membership.id) ?? null) : null;
  const status = statusFor(issues, membership);
  // The name the row ends with: this club's own record when the person is one of its members
  // (even a removed one), and otherwise what the file says — which is all the officer may see.
  const fullName = storedName ?? parsed.fullName;

  if (
    (status === 'existing' || status === 'restore') &&
    storedName &&
    storedName !== parsed.fullName
  ) {
    warnings.push({ field: 'fullName', code: 'name_differs' });
  }

  const row: MemberImportRow = {
    line: parsed.line,
    status,
    uniEmail: parsed.uniEmail,
    fullName,
    issues,
    warnings,
  };

  if (status === 'add' && parsed.uniEmail && parsed.fullName && membershipTypeId) {
    return {
      row,
      add: {
        line: parsed.line,
        uniEmail: parsed.uniEmail,
        fullName: parsed.fullName,
        userId: account?.userId ?? null,
        membershipTypeId,
        profile: parsed.profile,
        committeeIds,
      },
    };
  }
  if (status === 'restore' && membership && membershipTypeId) {
    return {
      row,
      restore: {
        line: parsed.line,
        membershipId: membership.id,
        membershipTypeId,
        profile: parsed.profile,
        committeeIds,
      },
    };
  }
  return { row };
}

function statusFor(
  issues: readonly MemberImportIssue[],
  membership: { removed: boolean } | null,
): MemberImportStatus {
  if (issues.length > 0) return 'invalid';
  if (!membership) return 'add';
  return membership.removed ? 'restore' : 'existing';
}

function resolveMembershipType(
  parsed: ParsedImportRow,
  club: ImportClubState,
  issues: MemberImportIssue[],
): string | null {
  if (parsed.membershipTypeName === null) return club.defaultMembershipTypeId;
  const type = matchByName(club.membershipTypes, parsed.membershipTypeName);
  if (!type) {
    issues.push({
      field: 'membershipType',
      code: 'unknown_membership_type',
      value: parsed.membershipTypeName,
    });
    return null;
  }
  return type.id;
}

function resolveCommittees(
  parsed: ParsedImportRow,
  club: ImportClubState,
  issues: MemberImportIssue[],
): string[] {
  const ids: string[] = [];
  for (const name of parsed.committeeNames) {
    const committee = matchByName(club.committees, name);
    if (!committee) {
      issues.push({ field: 'committees', code: 'unknown_committee', value: name });
      continue;
    }
    // An archived committee takes nothing new, here as everywhere else (ADR 0015).
    if (committee.archived) {
      issues.push({ field: 'committees', code: 'committee_archived', value: name });
      continue;
    }
    ids.push(committee.id);
  }
  return ids;
}

/**
 * A name from the file → one of the club's own rows. Exactly how the uniqueness constraint
 * compares names first (`normalizeEntityName`); failing that, the Arabic-folded spelling, so
 * "لجنة الاعلام" finds "لجنة الإعلام" — but only when exactly one candidate folds to it, because
 * guessing between two real committees is worse than refusing the row.
 */
function matchByName<T extends { name: string }>(candidates: readonly T[], name: string): T | null {
  const exact = candidates.find((candidate) => normalizeEntityName(candidate.name) === name);
  if (exact) return exact;
  const folded = normalizeForSearch(name);
  const matches = candidates.filter((candidate) => normalizeForSearch(candidate.name) === folded);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * SHA-256 of the plan: what the officer was shown, plus what each row would write.
 *
 * What is deliberately **not** in it: whether the address already has an account somewhere else.
 * An account created in another club between the two steps changes nothing this import does — the
 * membership is created either way and the stored name wins either way — so refusing the import
 * would only tell the officer that something happened to that address elsewhere.
 */
function checksumOf(plan: ImportPlan, clubId: string): string {
  const hash = createHash('sha256');
  hash.update(`v1\u001f${clubId}`);
  const adds = new Map(plan.adds.map((add) => [add.line, add]));
  const restores = new Map(plan.restores.map((restore) => [restore.line, restore]));

  for (const row of plan.rows) {
    const parts: string[] = [
      String(row.line),
      row.status,
      row.uniEmail ?? '',
      row.fullName ?? '',
      row.issues.map(issueKey).join(','),
      row.warnings.map(issueKey).join(','),
    ];
    const add = adds.get(row.line);
    const restore = restores.get(row.line);
    if (add)
      parts.push(add.membershipTypeId, committeeKey(add.committeeIds), profileKey(add.profile));
    if (restore) {
      parts.push(
        restore.membershipId,
        restore.membershipTypeId,
        committeeKey(restore.committeeIds),
        profileKey(restore.profile),
      );
    }
    hash.update(`\u001e${parts.join('\u001f')}`);
  }
  return hash.digest('hex');
}

function issueKey(issue: MemberImportIssue): string {
  return `${issue.field}:${issue.code}:${issue.value ?? ''}:${issue.at === undefined ? '' : String(issue.at)}`;
}

/** Order inside the cell is not a change. */
function committeeKey(committeeIds: readonly string[]): string {
  return [...committeeIds].sort().join(',');
}

function profileKey(profile: ImportProfile): string {
  return (Object.keys(profile) as Array<keyof ImportProfile>)
    .sort()
    .map((field) => `${field}=${String(profile[field])}`)
    .join(',');
}
