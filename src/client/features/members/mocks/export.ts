import writeXlsxFile, { type Cell } from 'write-excel-file/browser';

import { findMockActor, getMockDb } from '@/client/mocks/db';
import { mockEndpoint, mockError, mockFile } from '@/client/mocks/endpoint';
import membersExportMessages from '@/i18n/messages/ar/membersExport.json';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import type { Member } from '@/shared/contracts/members';
import {
  MEMBER_EXPORT_CONTENT_TYPE,
  MEMBER_EXPORT_MAX_ROWS,
  memberExportEndpoint,
  type MemberExportColumn,
} from '@/shared/contracts/members-export';
import { todayInAppTimeZone } from '@/shared/lib/dates';

import { canSeeClub, checkFilters } from './filters';
import { listMemberFixtures } from './fixtures';

/*
 * The members export on mocks, so the column picker and the export button can be built before
 * the backend is deployed (docs/adr/0025-members-export.md). It answers with a small but real
 * .xlsx — the header row and the members, right to left — and with the same refusals as the
 * server: 404 for a club the persona cannot list, 422 `entries_rejected` for ticked members
 * outside the list, 422 `too_many_rows`. The server's file has more (an about sheet, the formula
 * guard, column widths); the integration tests are what prove those.
 */

const values = membersExportMessages.values;

function cell(member: Member, column: MemberExportColumn): Cell {
  switch (column) {
    case 'fullName':
      return member.user.fullName;
    case 'uniEmail':
      return member.user.uniEmail;
    case 'phone':
      return member.profile.phone?.replace(/^\+966(5\d{8})$/, '0$1') ?? null;
    case 'personalEmail':
      return member.profile.personalEmail;
    case 'college':
      return member.profile.college;
    case 'major':
      return member.profile.major;
    case 'level':
      return member.profile.level;
    case 'membershipType':
      return member.membershipType.name;
    case 'role':
      return member.role === 'CLUB_OFFICER' ? values.roleOfficer : values.roleMember;
    case 'committees':
      return member.committees.map((committee) => committee.name).join('، ');
    case 'points':
      return member.points;
    case 'joinedAt':
      return member.joinedAt.slice(0, 10);
    case 'registered':
      return member.user.isRegistered ? values.registered : values.notRegistered;
    case 'status':
      return member.removedAt === null ? values.active : values.removed;
  }
}

export const memberExportHandlers = [
  mockEndpoint(memberExportEndpoint, async ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const club = db.clubsById.get(params.clubId);
    if (!club || !canSeeClub(db, actor, club.id)) return mockError('NOT_FOUND');

    const query = {
      ...body.filters,
      clubId: club.id,
      page: 1,
      pageSize: MEMBER_EXPORT_MAX_ROWS + 1,
    };
    const invalidFilter = checkFilters(db, actor, query);
    if (invalidFilter) return invalidFilter;
    let members = listMemberFixtures(db, actor, query).items;

    if (body.selection.kind === 'ids') {
      const found = new Set(members.map((member) => member.id));
      const rejected = body.selection.memberIds.flatMap((id, index) =>
        found.has(id) ? [] : [index],
      );
      if (rejected.length > 0) {
        return mockError('VALIDATION_FAILED', 'entries_rejected', {
          reason: 'entries_rejected',
          issues: rejected.map((index) => ({
            path: ['body', 'selection', 'memberIds', index],
            code: 'not_found',
            message: 'not_found',
          })),
        });
      }
      const ticked = new Set(body.selection.memberIds);
      members = members.filter((member) => ticked.has(member.id));
    }
    if (members.length > MEMBER_EXPORT_MAX_ROWS) {
      return mockError('VALIDATION_FAILED', 'too_many_rows', {
        reason: 'too_many_rows',
        issues: [{ path: ['body', 'selection'], code: 'too_many_rows', message: 'too_many_rows' }],
      });
    }

    const blob = await writeXlsxFile(
      [
        body.columns.map((column) => ({
          value: membersExportMessages.columns[column],
          fontWeight: 'bold' as const,
        })),
        ...members.map((member) => body.columns.map((column) => cell(member, column))),
      ],
      { sheet: membersExportMessages.sheets.members, rightToLeft: true, stickyRowsCount: 1 },
    ).toBlob();

    const today = todayInAppTimeZone();
    return mockFile(new Uint8Array(await blob.arrayBuffer()), {
      contentType: MEMBER_EXPORT_CONTENT_TYPE,
      filename: `أعضاء-${club.name.replace(/\s+/g, '-')}-${today}.xlsx`,
      fallbackFilename: `members-${club.slug}-${today}.xlsx`,
    });
  }),
];
