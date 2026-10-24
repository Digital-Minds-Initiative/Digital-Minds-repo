import { describe, expect, it } from 'vitest';

import { AuthzError, type Actor } from '@/server/authz';

import { assertCanDelete, assertCanDeletePerson } from '../policies';

const admin: Actor = { userId: 'admin', isFullAdmin: true, memberships: [] };
const officer: Actor = {
  userId: 'officer',
  isFullAdmin: false,
  memberships: [{ membershipId: 'm1', clubId: 'club', role: 'CLUB_OFFICER', committees: [] }],
};

function reasonOf(act: () => void): string | undefined {
  try {
    act();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthzError);
    return (error as AuthzError).reason;
  }
}

describe('deletion policies', () => {
  it('lets only full admins delete', () => {
    expect(reasonOf(() => assertCanDelete(admin))).toBeUndefined();
    expect(reasonOf(() => assertCanDelete(officer))).toBe('full_admin_required');
  });

  it('lets a full admin delete an ordinary person', () => {
    expect(
      reasonOf(() => assertCanDeletePerson(admin, { userId: 'someone', isFullAdmin: false })),
    ).toBeUndefined();
  });

  it('refuses the admin their own data, before the full-admin rule', () => {
    expect(
      reasonOf(() => assertCanDeletePerson(admin, { userId: 'admin', isFullAdmin: true })),
    ).toBe('cannot_delete_self');
  });

  it("refuses another full admin's data", () => {
    expect(
      reasonOf(() => assertCanDeletePerson(admin, { userId: 'other-admin', isFullAdmin: true })),
    ).toBe('cannot_delete_full_admin');
  });
});
