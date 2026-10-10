import { describe, expect, expectTypeOf, it } from 'vitest';

import { ClubRole, CommitteeRole } from '@/server/db/generated/enums';
import {
  clubRoleSchema,
  committeeRoleSchema,
  type ClubRole as ContractClubRole,
  type CommitteeRole as ContractCommitteeRole,
} from '@/shared/contracts/members';

/*
 * The API contracts define their own Zod enums (they must not import Prisma, which is server-only).
 * This test keeps them identical to the database enums.
 */
describe('role enums', () => {
  it('match between the database and the API contracts', () => {
    expect([...clubRoleSchema.options].sort()).toEqual(Object.values(ClubRole).sort());
    expect([...committeeRoleSchema.options].sort()).toEqual(Object.values(CommitteeRole).sort());
    expectTypeOf<ContractClubRole>().toEqualTypeOf<ClubRole>();
    expectTypeOf<ContractCommitteeRole>().toEqualTypeOf<CommitteeRole>();
  });
});
