import {
  canManageClub,
  getMockDb,
  findMockActor,
  type MockActor,
  type MockCommittee,
  type MockDb,
  type MockMembership,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { COMMITTEE_ADMISSION_TYPE_NAME } from '@/shared/contracts/members';
import {
  confirmCommitteeMemberImportEndpoint,
  confirmMemberImportEndpoint,
  MEMBER_IMPORT_MAX_BYTES,
  MEMBER_IMPORT_MAX_ROWS,
  memberImportColumns,
  memberImportRequiredColumns,
  previewCommitteeMemberImportEndpoint,
  previewMemberImportEndpoint,
  type MemberImportField,
  type MemberImportIssue,
  type MemberImportNotice,
  type MemberImportRow,
  type MemberImportSummary,
} from '@/shared/contracts/members-import';
import { toLatinDigits } from '@/shared/lib/arabic';
import { isAllowedEmailDomain, normalizeEmail } from '@/shared/lib/email-domains';
import { normalizeEntityName, normalizePersonName } from '@/shared/lib/names';
import { normalizePhone } from '@/shared/lib/phone';
import { collapseWhitespace } from '@/shared/lib/text';

/*
 * The CSV import on mocks, so the upload and preview screens can be built before the backend is
 * deployed: the same two steps, the same row states, the same refusals and the same 409 when the
 * import no longer matches the preview (docs/adr/0021-csv-member-import.md).
 *
 * It is deliberately simpler than the server inside: cells are split on the delimiter without
 * quoting rules, and the checksum is a plain string hash rather than SHA-256. Mocks imitate the
 * rules for a believable UI; the server and its integration tests are the real boundary.
 *
 * The template endpoint is not mocked: it answers with a file, which the browser downloads from
 * the real API.
 */

/** Matches ALLOWED_EMAIL_DOMAINS in .env.example. */
const MOCK_EMAIL_DOMAINS = ['uqu.edu.sa'];

const invalidFile = (code: string, field?: string) =>
  mockError('VALIDATION_FAILED', code, {
    issues: [{ path: ['body', 'file', ...(field ? [field] : [])], code, message: code }],
  });
const conflict = (reason: string) => mockError('CONFLICT', reason, { reason });

interface MockImportRow extends MemberImportRow {
  /** `join` rows: the active membership and the committees it goes into. */
  join?: { membership: MockMembership; committeeIds: string[] };
  /** What importing this row would do; absent for `join`, `existing` and `invalid`. */
  write?: {
    uniEmail: string;
    fullName: string;
    membershipId: string | null;
    typeId: string;
    committeeIds: string[];
    profile: {
      personalEmail: string | null;
      phone: string | null;
      college: string | null;
      major: string | null;
      level: number | null;
    };
  };
}

interface MockPlan {
  rows: MockImportRow[];
  summary: MemberImportSummary;
  ignoredColumns: string[];
  notices: MemberImportNotice[];
  checksum: string;
}

/** Where a file goes: a club, or one committee of it (docs/adr/0029-leads-add-members.md). */
type ImportTarget = { clubId: string } | { committeeId: string };

function previewOf(plan: MockPlan) {
  return {
    checksum: plan.checksum,
    ignoredColumns: plan.ignoredColumns,
    notices: plan.notices,
    summary: plan.summary,
    rows: plan.rows.map(toContractRow),
  };
}

export const memberImportHandlers = [
  mockEndpoint(previewMemberImportEndpoint, ({ cookies, params, body }) => {
    const plan = planOrError(cookies, { clubId: params.clubId }, body.file);
    return 'code' in plan ? plan : previewOf(plan);
  }),

  mockEndpoint(previewCommitteeMemberImportEndpoint, ({ cookies, params, body }) => {
    const plan = planOrError(cookies, { committeeId: params.committeeId }, body.file);
    return 'code' in plan ? plan : previewOf(plan);
  }),

  mockEndpoint(confirmMemberImportEndpoint, ({ cookies, params, body }) =>
    confirm(cookies, { clubId: params.clubId }, body),
  ),

  mockEndpoint(confirmCommitteeMemberImportEndpoint, ({ cookies, params, body }) =>
    confirm(cookies, { committeeId: params.committeeId }, body),
  ),
];

function confirm(
  cookies: Record<string, string>,
  target: ImportTarget,
  body: { file: string; checksum: string },
) {
  const plan = planOrError(cookies, target, body.file);
  if ('code' in plan) return plan;
  const clubId = plan.clubId;
  if (plan.checksum !== body.checksum) return conflict('import_changed');

  const db = getMockDb();
  let added = 0;
  let restored = 0;
  let joined = 0;
  for (const row of plan.rows) {
    if (row.join) {
      joinCommittees(row.join.membership, row.join.committeeIds);
      joined += 1;
    }
    if (!row.write) continue;
    apply(db, clubId, row.write);
    if (row.status === 'restore') restored += 1;
    else added += 1;
  }
  return {
    added,
    restored,
    joined,
    skippedExisting: plan.summary.existing,
    skippedInvalid: plan.summary.invalid,
  };
}

function planOrError(
  cookies: Record<string, string>,
  target: ImportTarget,
  file: string,
): (MockPlan & { clubId: string }) | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  if (!actor) return mockError('UNAUTHENTICATED');

  let clubId: string;
  let committee: MockCommittee | null = null;
  if ('clubId' in target) {
    clubId = target.clubId;
    const club = db.clubsById.get(clubId);
    if (!club || !canSee(db, actor, clubId)) return mockError('NOT_FOUND');
    if (!canManageClub(actor, clubId)) {
      return mockError('FORBIDDEN', 'club_management_required', {
        reason: 'club_management_required',
      });
    }
    if (club.archivedAt) return conflict('club_archived');
  } else {
    // A committee the persona leads, or one of a club they run; anything else is a 404.
    committee = db.committeesById.get(target.committeeId) ?? null;
    if (
      !committee ||
      !(canManageClub(actor, committee.clubId) || actor.ledCommitteeIds.includes(committee.id))
    ) {
      return mockError('NOT_FOUND');
    }
    clubId = committee.clubId;
    if (db.clubsById.get(clubId)?.archivedAt) return conflict('club_archived');
    if (committee.archivedAt) return conflict('committee_archived');
  }

  const text = decode(file);
  if (typeof text !== 'string') return text;
  const plan = buildPlan(db, actor, clubId, text, committee);
  return 'code' in plan ? plan : { ...plan, clubId };
}

/** A persona sees a club when they manage it or lead one of its committees. */
function canSee(db: MockDb, actor: MockActor, clubId: string): boolean {
  return (
    actor.user.isFullAdmin ||
    actor.officerClubIds.includes(clubId) ||
    db.committees.some(
      (committee) => committee.clubId === clubId && actor.ledCommitteeIds.includes(committee.id),
    )
  );
}

/** base64 → the file's text, refusing what is not UTF-8 — the real reason for sending bytes. */
function decode(file: string): string | MockError {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(file), (character) => character.charCodeAt(0));
  } catch {
    return invalidFile('invalid_base64');
  }
  if (bytes.byteLength === 0) return invalidFile('empty_file');
  if (bytes.byteLength > MEMBER_IMPORT_MAX_BYTES) return invalidFile('file_too_large');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return invalidFile('unsupported_encoding');
  }
  const body =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return invalidFile('unsupported_encoding');
  }
}

function buildPlan(
  db: MockDb,
  actor: MockActor,
  clubId: string,
  text: string,
  committee: MockCommittee | null,
): MockPlan | MockError {
  const lines = text.split(/\r?\n/);
  const headerLine = lines[0] ?? '';
  const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  const header = headerLine.split(delimiter);

  const columns: Partial<Record<MemberImportField, number>> = {};
  const ignoredColumns: string[] = [];
  header.forEach((cell, index) => {
    const name = collapseWhitespace(cell);
    if (name === '') return;
    const field = (Object.keys(memberImportColumns) as MemberImportField[]).find((candidate) =>
      memberImportColumns[candidate].some(
        (accepted) => accepted.toLowerCase() === name.toLowerCase(),
      ),
    );
    if (field && columns[field] === undefined) columns[field] = index;
    else ignoredColumns.push(name);
  });
  const missing = memberImportRequiredColumns.find((field) => columns[field] === undefined);
  if (missing) return invalidFile('missing_column', missing);

  const types = db.membershipTypes
    .filter((type) => type.clubId === clubId)
    .sort((a, b) => a.order - b.order);
  // A committee import gives everyone the club's «عضو» and ignores the type column (ADR 0029).
  const defaultType = committee
    ? types.find((type) => normalizeEntityName(type.name) === COMMITTEE_ADMISSION_TYPE_NAME)
    : types[0];
  if (!defaultType) {
    return conflict(committee ? 'member_type_missing' : 'club_has_no_membership_types');
  }
  const notices: MemberImportNotice[] = [];
  const committees = db.committees.filter((committee) => committee.clubId === clubId);

  const dataLines = lines
    .slice(1)
    .map((line, index) => ({ cells: line.split(delimiter), line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => collapseWhitespace(cell) !== ''));
  if (dataLines.length > MEMBER_IMPORT_MAX_ROWS) return invalidFile('too_many_rows');

  const summary: MemberImportSummary = {
    total: dataLines.length,
    add: 0,
    restore: 0,
    join: 0,
    existing: 0,
    invalid: 0,
  };
  const firstSeen = new Map<string, number>();
  const rows: MockImportRow[] = [];

  for (const { cells, line } of dataLines) {
    const issues: MemberImportIssue[] = [];
    const warnings: MemberImportIssue[] = [];
    const cell = (field: MemberImportField) => {
      const index = columns[field];
      return index === undefined ? '' : collapseWhitespace(cells[index] ?? '');
    };

    const rawName = cell('fullName');
    const fileName = rawName === '' ? null : normalizePersonName(rawName);
    if (!fileName) issues.push({ field: 'fullName', code: 'required' });

    const rawEmail = cell('uniEmail');
    let uniEmail: string | null = null;
    if (rawEmail === '') issues.push({ field: 'uniEmail', code: 'required' });
    else if (!rawEmail.includes('@')) issues.push({ field: 'uniEmail', code: 'invalid_email' });
    else if (!isAllowedEmailDomain(normalizeEmail(rawEmail), MOCK_EMAIL_DOMAINS)) {
      issues.push({ field: 'uniEmail', code: 'email_domain_not_allowed' });
    } else uniEmail = normalizeEmail(rawEmail);

    // The order matters: the screen lists a row's problems as they come, so the mock reports
    // them in the same order as the server — the file's own cells first, then what the club
    // makes of them.
    const phoneCell = cell('phone');
    const phone = phoneCell === '' ? null : normalizePhone(phoneCell);
    if (phoneCell !== '' && !phone) issues.push({ field: 'phone', code: 'invalid_phone' });
    const levelCell = toLatinDigits(cell('level'));
    const level = levelCell === '' ? null : Number(levelCell);
    if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 12)) {
      issues.push({ field: 'level', code: 'invalid_level' });
    }

    const duplicateOf = uniEmail === null ? undefined : firstSeen.get(uniEmail);
    if (duplicateOf !== undefined) {
      issues.push({ field: 'uniEmail', code: 'duplicate_in_file', at: duplicateOf });
    }

    const typeName = cell('membershipType');
    if (committee && typeName !== '' && notices.length === 0) {
      notices.push('membership_type_ignored');
    }
    const type =
      typeName === '' || committee
        ? defaultType
        : types.find((candidate) => normalizeEntityName(candidate.name) === typeName);
    if (!type) {
      issues.push({ field: 'membershipType', code: 'unknown_membership_type', value: typeName });
    }

    const committeeIds: string[] = [];
    const committeeCell = cell('committees');
    const names = committeeCell === '' ? [] : committeeCell.split(delimiter === ';' ? '،' : /[;،]/);
    for (const raw of names) {
      const name = normalizeEntityName(raw);
      if (name === '') continue;
      if (committee) {
        if (normalizeEntityName(committee.name) !== name) {
          issues.push({ field: 'committees', code: 'committee_not_target', value: name });
        }
        continue;
      }
      const found = committees.find((candidate) => normalizeEntityName(candidate.name) === name);
      if (!found) issues.push({ field: 'committees', code: 'unknown_committee', value: name });
      else if (found.archivedAt) {
        issues.push({ field: 'committees', code: 'committee_archived', value: name });
      } else committeeIds.push(found.id);
    }
    if (committee) committeeIds.push(committee.id);

    const user = uniEmail
      ? db.users.find((candidate) => candidate.uniEmail === uniEmail)
      : undefined;
    const membership = user
      ? db.memberships.find((row) => row.userId === user.id && row.clubId === clubId)
      : undefined;
    // Only this club's own members have a name the officer may see; an account elsewhere is told
    // apart nowhere, not even by a warning (docs/adr/0012-member-profiles-per-club.md).
    const storedName = membership ? (db.usersById.get(membership.userId)?.fullName ?? null) : null;
    // An active member goes into the committees the file names that they are not active in.
    const joinIds =
      membership && membership.removedAt === null
        ? [...new Set(committeeIds)].filter(
            (id) => !membership.committees.some((link) => link.committeeId === id && !link.removed),
          )
        : [];
    const status =
      issues.length > 0
        ? 'invalid'
        : !membership
          ? 'add'
          : membership.removedAt !== null
            ? 'restore'
            : joinIds.length > 0
              ? 'join'
              : 'existing';
    if (status !== 'add' && status !== 'invalid' && storedName && storedName !== fileName) {
      warnings.push({ field: 'fullName', code: 'name_differs' });
    }
    summary[status] += 1;

    const row: MockImportRow = {
      line,
      status,
      uniEmail,
      fullName: storedName ?? fileName,
      issues,
      warnings,
    };
    if (status === 'join' && membership) {
      row.join = { membership, committeeIds: joinIds };
      row.joinCommittees = joinIds.map(
        (id) => committees.find((committee) => committee.id === id)?.name ?? '',
      );
    }
    if ((status === 'add' || status === 'restore') && uniEmail && fileName && type) {
      row.write = {
        uniEmail,
        fullName: fileName,
        membershipId: membership?.id ?? null,
        typeId: type.id,
        committeeIds,
        profile: {
          personalEmail:
            cell('personalEmail') === '' ? null : normalizeEmail(cell('personalEmail')),
          phone,
          college: cell('college') === '' ? null : cell('college'),
          major: cell('major') === '' ? null : cell('major'),
          level,
        },
      };
    }
    rows.push(row);
    if (uniEmail && !firstSeen.has(uniEmail)) firstSeen.set(uniEmail, line);
  }

  return {
    rows,
    summary,
    ignoredColumns,
    notices,
    checksum: checksumOf(committee ? `${clubId}/${committee.id}` : clubId, rows),
  };
}

function toContractRow(row: MockImportRow): MemberImportRow {
  return {
    line: row.line,
    status: row.status,
    uniEmail: row.uniEmail,
    fullName: row.fullName,
    issues: row.issues,
    warnings: row.warnings,
    ...(row.joinCommittees ? { joinCommittees: row.joinCommittees } : {}),
  };
}

/** Writes one planned row into the mock database, restoring a removed membership in place. */
function apply(db: MockDb, clubId: string, write: NonNullable<MockImportRow['write']>): void {
  let user = db.users.find((candidate) => candidate.uniEmail === write.uniEmail);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      key: write.uniEmail,
      publicId: crypto.randomUUID().replaceAll('-', ''),
      fullName: write.fullName,
      uniEmail: write.uniEmail,
      isFullAdmin: false,
      registered: false,
      persona: 'unregistered',
    };
    db.users.push(user);
    db.usersById.set(user.id, user);
  }

  let membership = db.memberships.find((row) => row.userId === user.id && row.clubId === clubId) as
    MockMembership | undefined;
  if (membership) {
    // The same row comes back, so its committees and their points return with it; roles reset.
    membership.removedAt = null;
    membership.role = 'MEMBER';
    membership.typeId = write.typeId;
    membership.profile = write.profile;
    for (const link of membership.committees) link.role = 'MEMBER';
  } else {
    membership = {
      id: crypto.randomUUID(),
      userId: user.id,
      clubId,
      typeId: write.typeId,
      role: 'MEMBER',
      profile: write.profile,
      joinedAt: new Date().toISOString(),
      removedAt: null,
      committees: [],
    };
    db.memberships.push(membership);
  }
  joinCommittees(membership, write.committeeIds);
}

/** New committee links, and removed ones back as plain members. */
function joinCommittees(membership: MockMembership, committeeIds: readonly string[]): void {
  for (const committeeId of committeeIds) {
    const link = membership.committees.find((candidate) => candidate.committeeId === committeeId);
    if (link) {
      link.removed = false;
      link.role = 'MEMBER';
    } else membership.committees.push({ committeeId, role: 'MEMBER', removed: false });
  }
}

/**
 * A stand-in for the server's SHA-256: 64 hex characters that change whenever the plan does.
 * Hashing properly needs crypto.subtle, which is asynchronous; this only has to be stable.
 */
function checksumOf(clubId: string, rows: readonly MockImportRow[]): string {
  const canonical = [
    clubId,
    ...rows.map((row) =>
      [
        row.line,
        row.status,
        row.uniEmail ?? '',
        row.fullName ?? '',
        row.issues.map((issue) => `${issue.field}:${issue.code}:${issue.value ?? ''}`).join(','),
        row.warnings.map((issue) => `${issue.field}:${issue.code}`).join(','),
        row.write?.typeId ?? '',
        [...(row.write?.committeeIds ?? row.join?.committeeIds ?? [])].sort().join(','),
        JSON.stringify(row.write?.profile ?? {}),
      ].join('\u001f'),
    ),
  ].join('\u001e');

  let hash = '';
  for (let seed = 0; hash.length < 64; seed += 1) {
    let value = 0x811c9dc5 + seed * 0x01000193;
    for (let index = 0; index < canonical.length; index += 1) {
      value ^= canonical.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    hash += value.toString(16).padStart(8, '0');
  }
  return hash.slice(0, 64);
}
