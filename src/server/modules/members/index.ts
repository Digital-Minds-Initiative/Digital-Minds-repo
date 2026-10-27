import 'server-only';

export {
  addMemberToCommittee,
  admitMember,
  createMember,
  getMember,
  listMembers,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from './service';
export { exportMembers } from './export-service';
export {
  confirmCommitteeMemberImport,
  confirmMemberImport,
  getCommitteeMemberImportTemplate,
  getMemberImportTemplate,
  previewCommitteeMemberImport,
  previewMemberImport,
} from './import-service';
/*
 * This module owns the membership tables, so the role columns are written here — but a grant or a
 * revoke also writes the permissions module's history, and the two must commit together. The
 * permissions module calls these with its transaction client; it never writes these tables itself
 * (docs/adr/0018-granting-roles.md).
 */
export { setClubRole, setCommitteeRole } from './repository';
/*
 * The same for a full admin's deletes (docs/adr/0026-person-deletion.md): memberships, committee
 * memberships, the export log and the account are this module's, so the deletions module removes
 * them through these, with its transaction client.
 */
export {
  countClubMemberships,
  countCommitteeMemberships,
  deleteClubMemberExports,
  deleteCommitteeMemberships,
  deletePersonMemberships,
  erasePerson,
  findPersonForDeletion,
  lockCommitteeMemberships,
  lockPerson,
} from './repository';
