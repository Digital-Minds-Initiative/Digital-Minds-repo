import 'server-only';

import { clubsScope, committeeMembershipsScope, membersScope, type Actor } from '@/server/authz';
import { NotFoundError, ValidationError } from '@/server/errors';
import {
  MEMBER_EXPORT_CONTENT_TYPE,
  MEMBER_EXPORT_MAX_ISSUES,
  MEMBER_EXPORT_MAX_ROWS,
  type MemberExportBody,
} from '@/shared/contracts/members-export';
import { todayInAppTimeZone } from '@/shared/lib/dates';

import { buildMembersFile, membersFileNames } from './export-file';
import { consumeMemberExportLimit } from './export-rate-limits';
import { countMembers, findClubForExport, saveMemberExport } from './repository';
import { findListedMembers, resolveListFilters, toMemberFilters } from './service';

/*
 * The members export (docs/adr/0025-members-export.md). It is the members list, written to a
 * file: the same filters resolved through the same scopes, the same rows in the same order, the
 * same `Member` objects and the same points. Nothing here decides who sees what — that is the
 * list's.
 */

export interface MemberExportFile {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
  /** Arabic, sent as `filename*`. */
  filename: string;
  /** ASCII, sent as `filename`. */
  fallbackFilename: string;
}

export async function exportMembers(
  actor: Actor,
  clubId: string,
  body: MemberExportBody,
  now: Date = new Date(),
): Promise<MemberExportFile> {
  // First, before any lookup: every attempt costs the same, whatever it would have answered.
  await consumeMemberExportLimit(actor.userId, now);

  // `clubsScope` reaches exactly the clubs whose members the actor can list (managed, or with a
  // committee they lead), so an ordinary member, an officer of another club and a lead elsewhere
  // all stop here with the list's own 404 — never with an empty file.
  const club = await findClubForExport(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');

  const query = { ...body.filters, clubId: club.id };
  const basis = await resolveListFilters(actor, query);
  const filters = toMemberFilters(query);
  const { selection } = body;

  if (selection.kind === 'all') {
    // Counted before anything is read, so an oversized request costs one COUNT.
    const count = await countMembers(
      membersScope(actor),
      committeeMembershipsScope(actor),
      filters,
    );
    if (count > MEMBER_EXPORT_MAX_ROWS) throw tooManyRows(count);
  } else {
    filters.memberIds = selection.memberIds;
  }

  // One more than the limit, so a member added since the count is noticed, not cut off.
  const { items } = await findListedMembers(actor, filters, query, basis, {
    page: 1,
    pageSize: MEMBER_EXPORT_MAX_ROWS + 1,
  });
  if (items.length > MEMBER_EXPORT_MAX_ROWS) throw tooManyRows(items.length);

  if (selection.kind === 'ids') {
    // Decided on the rows that will be written, not on an earlier read, so a member removed in
    // between is refused rather than quietly missing from the file.
    const found = new Set(items.map((member) => member.id));
    const rejected = selection.memberIds.flatMap((id, index) => (found.has(id) ? [] : [index]));
    if (rejected.length > 0) throw membersRejected(rejected);
  }

  const exportedOn = todayInAppTimeZone(now);
  const data = await buildMembersFile({
    club,
    columns: body.columns,
    members: items,
    selection: selection.kind,
    pointsBasis: basis,
    exportedOn,
  });

  // Last, once the file exists: a refused or failed export leaves no row behind.
  await saveMemberExport(clubsScope(actor), {
    clubId: club.id,
    exportedById: actor.userId,
    selection: selection.kind === 'ids' ? 'IDS' : 'ALL',
    selectedCount: selection.kind === 'ids' ? selection.memberIds.length : null,
    filters: loggedFilters(body.filters),
    columns: [...body.columns],
    rowCount: items.length,
  });

  return { data, contentType: MEMBER_EXPORT_CONTENT_TYPE, ...membersFileNames(club, exportedOn) };
}

/**
 * The filters as the log keeps them. The search text is not kept — it is often a name, a phone
 * number or an email — only that there was one.
 */
function loggedFilters(
  filters: MemberExportBody['filters'],
): Record<string, string | boolean | string[]> {
  const { q, ...rest } = filters;
  const kept = Object.entries(rest).filter(
    (entry): entry is [string, string | boolean | string[]] => entry[1] !== undefined,
  );
  return { ...Object.fromEntries(kept), search: q !== undefined };
}

function tooManyRows(count: number): ValidationError {
  return new ValidationError(
    [{ path: ['body', 'selection'], code: 'too_many_rows', message: 'too_many_rows' }],
    `${String(count)} members match; one file holds at most ${String(MEMBER_EXPORT_MAX_ROWS)}.`,
    'too_many_rows',
  );
}

/**
 * All or nothing, the way bulk points refuses: every ticked member who is not in the list the
 * filters describe — out of scope, nonexistent, removed under `status: active`, from another
 * club — is named by their position in `memberIds`, and nothing is exported. `not_found` covers
 * all of them alike, so the answer never tells an out-of-scope member from a missing one.
 */
function membersRejected(indexes: readonly number[]): ValidationError {
  return new ValidationError(
    indexes.slice(0, MEMBER_EXPORT_MAX_ISSUES).map((index) => ({
      path: ['body', 'selection', 'memberIds', index],
      code: 'not_found',
      message: 'not_found',
    })),
    `${String(indexes.length)} of the selected members are not in this list.`,
    'entries_rejected',
  );
}
