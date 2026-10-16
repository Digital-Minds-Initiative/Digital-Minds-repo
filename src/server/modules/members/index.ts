import 'server-only';

export {
  addMemberToCommittee,
  createMember,
  getMember,
  listMembers,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from './service';
/*
 * This module owns the membership tables, so the role columns are written here — but a grant or a
 * revoke also writes the permissions module's history, and the two must commit together. The
 * permissions module calls these with its transaction client; it never writes these tables itself
 * (docs/adr/0018-granting-roles.md).
 */
export { setClubRole, setCommitteeRole } from './repository';
