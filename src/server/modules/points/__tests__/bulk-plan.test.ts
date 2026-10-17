import { describe, expect, it } from 'vitest';

import {
  buildBulkPointsPlan,
  bulkPointsRequestHash,
  committeeMembershipKey,
  type BulkPointsState,
} from '../bulk-plan';

/*
 * The pure half of bulk points: which entries are writable, which are refused and why, and the
 * hash that makes a resend a replay. The integration tests prove the same rules through the real
 * database; these pin down the decisions themselves, including the ones a request cannot reach.
 */

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const A1 = 'committee-a1';
const A2 = 'committee-a2';
const B1 = 'committee-b1';

const ARCHIVED = 'committee-a3-archived';

function stateFor(
  overrides: {
    members?: Array<[string, { removed: boolean }]>;
    links?: Array<[string, string]>;
  } = {},
): BulkPointsState {
  return {
    clubId: CLUB_A,
    members: new Map(
      overrides.members ?? [
        ['member-1', { removed: false }],
        ['member-2', { removed: false }],
      ],
    ),
    committees: new Map([
      [A1, { id: A1, name: 'لجنة أ1', clubId: CLUB_A, archived: false }],
      [A2, { id: A2, name: 'لجنة أ2', clubId: CLUB_A, archived: false }],
      [ARCHIVED, { id: ARCHIVED, name: 'لجنة مؤرشفة', clubId: CLUB_A, archived: true }],
      [B1, { id: B1, name: 'لجنة ب1', clubId: CLUB_B, archived: false }],
    ]),
    committeeMemberships: new Map(
      overrides.links ?? [
        [committeeMembershipKey('member-1', A1), 'cm-1-a1'],
        [committeeMembershipKey('member-2', A1), 'cm-2-a1'],
        [committeeMembershipKey('member-1', A2), 'cm-1-a2'],
      ],
    ),
  };
}

describe('planning a bulk-points request', () => {
  it('turns every usable entry into a write, in the order they were sent', () => {
    const plan = buildBulkPointsPlan(
      [
        { memberId: 'member-2', committeeId: A1 },
        { memberId: 'member-1', committeeId: A1 },
      ],
      stateFor(),
    );
    expect(plan.failures).toEqual([]);
    expect(plan.writes).toEqual([
      { committeeMembershipId: 'cm-2-a1', committeeId: A1 },
      { committeeMembershipId: 'cm-1-a1', committeeId: A1 },
    ]);
  });

  it('writes the same member twice when they are picked in two committees', () => {
    const plan = buildBulkPointsPlan(
      [
        { memberId: 'member-1', committeeId: A1 },
        { memberId: 'member-1', committeeId: A2 },
      ],
      stateFor(),
    );
    expect(plan.failures).toEqual([]);
    expect(plan.writes).toEqual([
      { committeeMembershipId: 'cm-1-a1', committeeId: A1 },
      { committeeMembershipId: 'cm-1-a2', committeeId: A2 },
    ]);
  });

  it('refuses a member nobody can see, and one who was removed, differently', () => {
    const plan = buildBulkPointsPlan(
      [
        { memberId: 'stranger', committeeId: A1 },
        { memberId: 'member-2', committeeId: A1 },
      ],
      stateFor({
        members: [
          ['member-2', { removed: true }],
          ['member-1', { removed: false }],
        ],
      }),
    );
    expect(plan.writes).toEqual([]);
    expect(plan.failures).toEqual([
      { index: 0, field: 'memberId', code: 'not_found' },
      { index: 1, field: 'memberId', code: 'member_removed' },
    ]);
  });

  it('refuses a member who is in the club but not in that committee', () => {
    const plan = buildBulkPointsPlan([{ memberId: 'member-2', committeeId: A2 }], stateFor());
    expect(plan.writes).toEqual([]);
    expect(plan.failures).toEqual([{ index: 0, field: 'memberId', code: 'not_in_committee' }]);
  });

  it('refuses a committee of another club, an archived one, and one out of reach', () => {
    const plan = buildBulkPointsPlan(
      [
        { memberId: 'member-1', committeeId: B1 },
        { memberId: 'member-1', committeeId: ARCHIVED },
        { memberId: 'member-1', committeeId: 'committee-nobody-knows' },
      ],
      stateFor(),
    );
    expect(plan.writes).toEqual([]);
    expect(plan.failures).toEqual([
      { index: 0, field: 'committeeId', code: 'committee_not_in_club' },
      { index: 1, field: 'committeeId', code: 'committee_archived' },
      { index: 2, field: 'committeeId', code: 'not_found' },
    ]);
  });

  it('blames the committee when both halves of a pair are wrong', () => {
    // One unusable committee would otherwise be reported as a crowd of members "not in it".
    const plan = buildBulkPointsPlan([{ memberId: 'stranger', committeeId: B1 }], stateFor());
    expect(plan.failures).toEqual([
      { index: 0, field: 'committeeId', code: 'committee_not_in_club' },
    ]);
  });

  it('keeps the writable entries out of the plan when any entry fails', () => {
    // All or nothing is the caller's rule, but the plan must still report both sides of it.
    const plan = buildBulkPointsPlan(
      [
        { memberId: 'member-1', committeeId: A1 },
        { memberId: 'stranger', committeeId: A1 },
      ],
      stateFor(),
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.failures).toHaveLength(1);
  });

  it('indexes failures by the position in the array the client sent', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      memberId: index === 3 ? 'stranger' : 'member-1',
      committeeId: A1,
    }));
    const plan = buildBulkPointsPlan(entries, stateFor());
    expect(plan.failures).toEqual([{ index: 3, field: 'memberId', code: 'not_found' }]);
  });
});

describe('the request hash', () => {
  const base = {
    actorUserId: 'officer-a',
    target: { kind: 'committee', committeeId: A1 } as const,
    amount: 10,
    reason: 'حضور اللقاء التعريفي',
    workDate: '2026-10-17',
    entries: [
      { memberId: 'member-1', committeeId: A1 },
      { memberId: 'member-2', committeeId: A1 },
    ],
  };
  const firstEntryOnly = [{ memberId: 'member-1', committeeId: A1 }];

  it('ignores the order of the entries, so a re-sorted retry is still a replay', () => {
    expect(bulkPointsRequestHash({ ...base, entries: [...base.entries].reverse() })).toBe(
      bulkPointsRequestHash(base),
    );
  });

  it('changes when anything about the request changes', () => {
    const original = bulkPointsRequestHash(base);
    expect(bulkPointsRequestHash({ ...base, amount: 11 })).not.toBe(original);
    expect(bulkPointsRequestHash({ ...base, reason: 'شيء آخر' })).not.toBe(original);
    expect(bulkPointsRequestHash({ ...base, workDate: '2026-10-16' })).not.toBe(original);
    expect(bulkPointsRequestHash({ ...base, entries: firstEntryOnly })).not.toBe(original);
  });

  it('changes with the actor, so one person cannot replay another person batch', () => {
    expect(bulkPointsRequestHash({ ...base, actorUserId: 'officer-b' })).not.toBe(
      bulkPointsRequestHash(base),
    );
  });

  it('changes with the endpoint, so one key cannot cross from a committee to a club', () => {
    expect(bulkPointsRequestHash({ ...base, target: { kind: 'club', clubId: CLUB_A } })).not.toBe(
      bulkPointsRequestHash(base),
    );
  });

  it('is a lower-case sha256 hex digest, as the stored column requires', () => {
    expect(bulkPointsRequestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
