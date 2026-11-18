import { describe, expect, it } from 'vitest';

import { membershipTypeChangeSchema } from '@/shared/contracts/clubs';

import { toMembershipTypeChange } from '../mappers';
import type { MembershipTypeChangeRow } from '../repository';

const ID = '0192d000-0000-7000-8000-000000000001';
const CLUB = '0192d000-0000-7000-8000-000000000002';

function row(overrides: Partial<MembershipTypeChangeRow>): MembershipTypeChangeRow {
  return {
    id: ID,
    clubId: CLUB,
    kind: 'TYPE_CREATED',
    source: null,
    previousName: null,
    newName: 'متطوع',
    movedMembers: null,
    createdAt: new Date('2026-11-16T10:00:00.000Z'),
    membership: null,
    changedBy: { id: ID, fullName: 'مدير شؤون', deletedAt: null },
    ...overrides,
  };
}

describe('toMembershipTypeChange', () => {
  it('gives each kind only its own fields, valid against the contract', () => {
    const rows = [
      row({}),
      row({ kind: 'TYPE_RENAMED', previousName: 'متطوع', newName: 'متطوع نشط' }),
      row({ kind: 'TYPE_DELETED', previousName: 'مؤقت', newName: null, movedMembers: 0 }),
      row({
        kind: 'MEMBER_TYPE_CHANGED',
        source: 'TYPE_DELETED',
        previousName: 'مؤقت',
        newName: 'عضو',
        membership: { id: ID, user: { fullName: 'ريم' } },
      }),
    ];
    for (const input of rows) {
      const change = toMembershipTypeChange(input);
      expect(membershipTypeChangeSchema.safeParse(change).success, input.kind).toBe(true);
    }
    expect(
      toMembershipTypeChange(
        row({ kind: 'TYPE_DELETED', previousName: 'مؤقت', newName: 'عضو', movedMembers: 4 }),
      ),
    ).toMatchObject({ kind: 'TYPE_DELETED', name: 'مؤقت', movedMembers: 4, movedTo: 'عضو' });
  });

  it('names a deleted author as nobody', () => {
    const change = toMembershipTypeChange(
      row({ changedBy: { id: ID, fullName: '', deletedAt: new Date() } }),
    );
    expect(change.changedBy).toEqual({ userId: ID, fullName: null });
  });

  it('refuses a row missing what its kind needs rather than send it half-filled', () => {
    expect(() =>
      toMembershipTypeChange(
        row({ kind: 'MEMBER_TYPE_CHANGED', source: 'EDIT', membership: null }),
      ),
    ).toThrow(/incomplete/);
  });
});
