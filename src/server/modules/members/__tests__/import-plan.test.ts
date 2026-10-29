import { describe, expect, it } from 'vitest';

import type { ParsedImportRow } from '../import-csv';
import { admissionTypeId, buildImportPlan, type ImportClubState } from '../import-plan';

/*
 * What each row would do, and the checksum that makes the import match the preview
 * (docs/adr/0021-csv-member-import.md). No database here: the plan is a pure function of the
 * file and what the club holds, which is what lets the import run it again inside its
 * transaction and compare.
 */

const CLUB = '0192d000-0000-7000-8000-00000000c1b0';
const TYPE_MEMBER = '0192d000-0000-7000-8000-0000000000a1';
const TYPE_ACTIVE = '0192d000-0000-7000-8000-0000000000a2';
const MEDIA = '0192d000-0000-7000-8000-0000000000c1';
const TECH = '0192d000-0000-7000-8000-0000000000c2';
const OLD = '0192d000-0000-7000-8000-0000000000c3';
const MEMBERSHIP = '0192d000-0000-7000-8000-0000000000b1';
const USER = '0192d000-0000-7000-8000-0000000000d1';

let line = 1;
function row(overrides: Partial<ParsedImportRow> = {}): ParsedImportRow {
  line += 1;
  return {
    line,
    uniEmail: 's441000001@uqu.edu.sa',
    fullName: 'أحمد علي',
    profile: {},
    membershipTypeName: null,
    committeeNames: [],
    issues: [],
    ...overrides,
  };
}

function clubState(overrides: Partial<ImportClubState> = {}): ImportClubState {
  return {
    clubId: CLUB,
    defaultMembershipTypeId: TYPE_MEMBER,
    committee: null,
    membershipTypes: [
      { id: TYPE_MEMBER, name: 'عضو' },
      { id: TYPE_ACTIVE, name: 'عضو فعال' },
    ],
    committees: [
      { id: MEDIA, name: 'لجنة الإعلام', archived: false },
      { id: TECH, name: 'لجنة التقنية', archived: false },
      { id: OLD, name: 'لجنة قديمة', archived: true },
    ],
    accounts: new Map(),
    storedNames: new Map(),
    activeCommittees: new Map(),
    ...overrides,
  };
}

/** An account that exists but has no membership in this club — in another club, or pre-added. */
const accountElsewhere = (uniEmail: string) =>
  new Map([[uniEmail, { userId: USER, membership: null }]]);

const membershipIn = (
  uniEmail: string,
  removed: boolean,
  name = 'أحمد علي',
  activeIn: string[] = [],
) => ({
  accounts: new Map([[uniEmail, { userId: USER, membership: { id: MEMBERSHIP, removed } }]]),
  storedNames: new Map([[MEMBERSHIP, name]]),
  activeCommittees: new Map([[MEMBERSHIP, new Set(activeIn)]]),
});

describe('row states', () => {
  it('is `add` for an address nobody has', () => {
    const plan = buildImportPlan([row()], clubState());
    expect(plan.rows[0]).toMatchObject({ status: 'add', fullName: 'أحمد علي', issues: [] });
    expect(plan.adds).toHaveLength(1);
    expect(plan.adds[0]).toMatchObject({ userId: null, membershipTypeId: TYPE_MEMBER });
    expect(plan.summary).toMatchObject({ total: 1, add: 1, restore: 0, existing: 0, invalid: 0 });
  });

  it('is `add`, with the account linked, for an address that has one outside this club', () => {
    const uniEmail = 's441000009@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail })],
      clubState({ accounts: accountElsewhere(uniEmail) }),
    );
    expect(plan.rows[0]?.status).toBe('add');
    expect(plan.adds[0]?.userId).toBe(USER);
  });

  it('is `restore` for a membership this club removed', () => {
    const uniEmail = 's441000002@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, membershipTypeName: 'عضو فعال', committeeNames: ['لجنة التقنية'] })],
      clubState(membershipIn(uniEmail, true)),
    );
    expect(plan.rows[0]).toMatchObject({ status: 'restore', issues: [], warnings: [] });
    expect(plan.restores).toEqual([
      {
        line: plan.rows[0]?.line,
        membershipId: MEMBERSHIP,
        membershipTypeId: TYPE_ACTIVE,
        profile: {},
        committeeIds: [TECH],
      },
    ]);
  });

  it('is `existing` for an active member, and writes nothing', () => {
    const uniEmail = 's441000003@uqu.edu.sa';
    const plan = buildImportPlan([row({ uniEmail })], clubState(membershipIn(uniEmail, false)));
    expect(plan.rows[0]?.status).toBe('existing');
    expect(plan.adds).toEqual([]);
    expect(plan.restores).toEqual([]);
    expect(plan.joins).toEqual([]);
    expect(plan.summary).toMatchObject({ existing: 1, join: 0 });
  });

  it('is `existing` for an active member already in every committee the file names', () => {
    const uniEmail = 's441000014@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, committeeNames: ['لجنة الإعلام'] })],
      clubState(membershipIn(uniEmail, false, 'أحمد علي', [MEDIA])),
    );
    expect(plan.rows[0]?.status).toBe('existing');
    expect(plan.rows[0]?.joinCommittees).toBeUndefined();
    expect(plan.joins).toEqual([]);
  });

  it('is `join` for an active member the file puts in committees they are not active in', () => {
    const uniEmail = 's441000015@uqu.edu.sa';
    const plan = buildImportPlan(
      [
        row({
          uniEmail,
          membershipTypeName: 'عضو فعال',
          profile: { phone: '+966551110000' },
          committeeNames: ['لجنة الإعلام', 'لجنة التقنية', 'لجنة التقنية'],
        }),
      ],
      clubState(membershipIn(uniEmail, false, 'أحمد علي', [MEDIA])),
    );
    expect(plan.rows[0]).toMatchObject({
      status: 'join',
      joinCommittees: ['لجنة التقنية'],
      issues: [],
    });
    // Only the committee: no type, no profile, no name.
    expect(plan.joins).toEqual([
      { line: plan.rows[0]?.line, membershipId: MEMBERSHIP, committeeIds: [TECH] },
    ]);
    expect(plan.adds).toEqual([]);
    expect(plan.restores).toEqual([]);
    expect(plan.summary).toMatchObject({ join: 1, existing: 0 });
  });

  it('is `invalid`, not `join`, when an active member’s committee cannot be used', () => {
    const uniEmail = 's441000016@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, committeeNames: ['لجنة التقنية', 'لجنة قديمة', 'لجنة لا توجد'] })],
      clubState(membershipIn(uniEmail, false)),
    );
    expect(plan.rows[0]).toMatchObject({
      status: 'invalid',
      issues: [
        { code: 'committee_archived', value: 'لجنة قديمة' },
        { code: 'unknown_committee', value: 'لجنة لا توجد' },
      ],
    });
    expect(plan.joins).toEqual([]);
  });

  it('is `invalid` when the file itself gave the row a problem', () => {
    const plan = buildImportPlan(
      [row({ uniEmail: null, fullName: null, issues: [{ field: 'uniEmail', code: 'required' }] })],
      clubState(),
    );
    expect(plan.rows[0]).toMatchObject({ status: 'invalid', issues: [{ code: 'required' }] });
    expect(plan.adds).toEqual([]);
  });
});

describe('names of this club', () => {
  it('matches a membership type and a committee by name', () => {
    const plan = buildImportPlan(
      [row({ membershipTypeName: 'عضو فعال', committeeNames: ['لجنة الإعلام', 'لجنة التقنية'] })],
      clubState(),
    );
    expect(plan.adds[0]).toMatchObject({
      membershipTypeId: TYPE_ACTIVE,
      committeeIds: [MEDIA, TECH],
    });
  });

  it('matches a name written without its hamza, when only one candidate folds to it', () => {
    const plan = buildImportPlan([row({ committeeNames: ['لجنة الاعلام'] })], clubState());
    expect(plan.rows[0]?.issues).toEqual([]);
    expect(plan.adds[0]?.committeeIds).toEqual([MEDIA]);
  });

  it('refuses the row when two committees fold to the same name', () => {
    const club = clubState({
      committees: [
        { id: MEDIA, name: 'لجنة الإعلام', archived: false },
        { id: TECH, name: 'لجنة الاعلام', archived: false },
      ],
    });
    // Exact spelling still wins outright...
    expect(
      buildImportPlan([row({ committeeNames: ['لجنة الإعلام'] })], club).adds[0]?.committeeIds,
    ).toEqual([MEDIA]);
    // ...but a spelling that matches neither exactly must not be guessed.
    expect(
      buildImportPlan([row({ committeeNames: ['لجنة الأعلام'] })], club).rows[0],
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'unknown_committee', value: 'لجنة الأعلام' }],
    });
  });

  it('names the type or committee it could not find', () => {
    const plan = buildImportPlan(
      [row({ membershipTypeName: 'ذهبي', committeeNames: ['لجنة الإعلام', 'لجنة الطعام'] })],
      clubState(),
    );
    expect(plan.rows[0]?.issues).toEqual([
      { field: 'membershipType', code: 'unknown_membership_type', value: 'ذهبي' },
      { field: 'committees', code: 'unknown_committee', value: 'لجنة الطعام' },
    ]);
  });

  it('refuses a row naming an archived committee', () => {
    const plan = buildImportPlan([row({ committeeNames: ['لجنة قديمة'] })], clubState());
    expect(plan.rows[0]).toMatchObject({
      status: 'invalid',
      issues: [{ field: 'committees', code: 'committee_archived', value: 'لجنة قديمة' }],
    });
  });

  it('falls back to the club’s first type when the cell is empty', () => {
    expect(buildImportPlan([row()], clubState()).adds[0]?.membershipTypeId).toBe(TYPE_MEMBER);
  });
});

describe('the same address twice in one file', () => {
  it('imports the first row and points every later one at it', () => {
    const uniEmail = 's441000004@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail }), row({ uniEmail }), row({ uniEmail })],
      clubState(),
    );
    const [first, second, third] = plan.rows;
    expect(first?.status).toBe('add');
    expect(second).toMatchObject({
      status: 'invalid',
      issues: [{ field: 'uniEmail', code: 'duplicate_in_file', at: first?.line }],
    });
    expect(third?.issues[0]).toMatchObject({ code: 'duplicate_in_file', at: first?.line });
    expect(plan.adds).toHaveLength(1);
    expect(plan.summary).toMatchObject({ total: 3, add: 1, invalid: 2 });
  });

  it('still points at the first row when that row is itself invalid', () => {
    const uniEmail = 's441000005@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, issues: [{ field: 'phone', code: 'invalid_phone' }] }), row({ uniEmail })],
      clubState(),
    );
    expect(plan.rows[1]?.issues).toEqual([
      { field: 'uniEmail', code: 'duplicate_in_file', at: plan.rows[0]?.line },
    ]);
    expect(plan.adds).toEqual([]);
  });

  it('does not treat two rows without an address as duplicates of each other', () => {
    const plan = buildImportPlan(
      [
        row({ uniEmail: null, issues: [{ field: 'uniEmail', code: 'required' }] }),
        row({ uniEmail: null, issues: [{ field: 'uniEmail', code: 'required' }] }),
      ],
      clubState(),
    );
    for (const parsed of plan.rows)
      expect(parsed.issues).toEqual([{ field: 'uniEmail', code: 'required' }]);
  });
});

describe('the stored name', () => {
  it('wins over the file for a member of this club, with a warning', () => {
    const uniEmail = 's441000006@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, fullName: 'احمد علي' })],
      clubState(membershipIn(uniEmail, false, 'أحمد علي الزهراني')),
    );
    expect(plan.rows[0]).toMatchObject({
      status: 'existing',
      fullName: 'أحمد علي الزهراني',
      warnings: [{ field: 'fullName', code: 'name_differs' }],
    });
  });

  it('warns on a restore too, and never writes the file’s name', () => {
    const uniEmail = 's441000007@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, fullName: 'سارة' })],
      clubState(membershipIn(uniEmail, true, 'سارة محمد')),
    );
    expect(plan.rows[0]).toMatchObject({
      status: 'restore',
      fullName: 'سارة محمد',
      warnings: [{ code: 'name_differs' }],
    });
    // A restore carries no name at all: the account keeps the one it has.
    expect(Object.keys(plan.restores[0] ?? {})).not.toContain('fullName');
  });

  it('says nothing about an account outside this club, not even that it differs', () => {
    // The officer may not see that name — or that the address has an account at all (ADR 0012).
    const uniEmail = 's441000008@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, fullName: 'الاسم من الملف' })],
      clubState({ accounts: accountElsewhere(uniEmail), storedNames: new Map() }),
    );
    expect(plan.rows[0]).toMatchObject({
      status: 'add',
      fullName: 'الاسم من الملف',
      warnings: [],
    });
  });

  it('is left alone when it already matches', () => {
    const uniEmail = 's441000010@uqu.edu.sa';
    const plan = buildImportPlan(
      [row({ uniEmail, fullName: 'أحمد علي' })],
      clubState(membershipIn(uniEmail, false, 'أحمد علي')),
    );
    expect(plan.rows[0]?.warnings).toEqual([]);
  });
});

describe('the checksum', () => {
  const planOf = (rows: ParsedImportRow[], club = clubState()) =>
    buildImportPlan(rows, club).checksum;

  it('is the same for the same file and the same club', () => {
    line = 1;
    const first = planOf([row(), row({ uniEmail: 's441000011@uqu.edu.sa' })]);
    line = 1;
    const second = planOf([row(), row({ uniEmail: 's441000011@uqu.edu.sa' })]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a row changes state — somebody added that person meanwhile', () => {
    const uniEmail = 's441000012@uqu.edu.sa';
    line = 1;
    const before = planOf([row({ uniEmail })]);
    line = 1;
    const after = planOf([row({ uniEmail })], clubState(membershipIn(uniEmail, false)));
    expect(after).not.toBe(before);
  });

  it('changes when a member joins one of the file’s committees meanwhile', () => {
    const uniEmail = 's441000017@uqu.edu.sa';
    const rows = () => [row({ uniEmail, committeeNames: ['لجنة الإعلام', 'لجنة التقنية'] })];
    line = 1;
    const before = planOf(rows(), clubState(membershipIn(uniEmail, false)));
    line = 1;
    const after = planOf(rows(), clubState(membershipIn(uniEmail, false, 'أحمد علي', [MEDIA])));
    expect(after).not.toBe(before);
  });

  it('changes when the file changes but the states do not', () => {
    line = 1;
    const before = planOf([row({ profile: { phone: '+966551110000' } })]);
    line = 1;
    const after = planOf([row({ profile: { phone: '+966552220000' } })]);
    expect(after).not.toBe(before);
  });

  it('changes when a committee or a type the rows name is renamed away', () => {
    line = 1;
    const before = planOf([row({ committeeNames: ['لجنة الإعلام'] })]);
    line = 1;
    const after = planOf(
      [row({ committeeNames: ['لجنة الإعلام'] })],
      clubState({ committees: [{ id: TECH, name: 'لجنة التقنية', archived: false }] }),
    );
    expect(after).not.toBe(before);
  });

  it('ignores the order committees are written in inside the cell', () => {
    line = 1;
    const before = planOf([row({ committeeNames: ['لجنة الإعلام', 'لجنة التقنية'] })]);
    line = 1;
    const after = planOf([row({ committeeNames: ['لجنة التقنية', 'لجنة الإعلام'] })]);
    expect(after).toBe(before);
  });

  it('does not change when an account appears elsewhere between the two steps', () => {
    // Nothing this import does changes: the membership is created either way and the account's
    // own name wins either way. Refusing would only report what happened in another club.
    const uniEmail = 's441000013@uqu.edu.sa';
    line = 1;
    const before = planOf([row({ uniEmail })]);
    line = 1;
    const after = planOf([row({ uniEmail })], clubState({ accounts: accountElsewhere(uniEmail) }));
    expect(after).toBe(before);
  });

  it('is club-specific', () => {
    line = 1;
    const before = planOf([row()]);
    line = 1;
    const after = planOf([row()], clubState({ clubId: '0192d000-0000-7000-8000-00000000c1b1' }));
    expect(after).not.toBe(before);
  });
});

describe('committee mode (docs/adr/0029-leads-add-members.md)', () => {
  const inMedia = (overrides: Partial<ImportClubState> = {}) =>
    clubState({ committee: { id: MEDIA, name: 'لجنة الإعلام' }, ...overrides });

  it('puts every row that writes into the committee, whether its cell is empty or names it', () => {
    const plan = buildImportPlan(
      [
        row({ uniEmail: 's441000101@uqu.edu.sa' }),
        row({ uniEmail: 's441000102@uqu.edu.sa', committeeNames: ['لجنة الاعلام'] }),
      ],
      inMedia(),
    );
    expect(plan.rows.map((r) => r.status)).toEqual(['add', 'add']);
    expect(plan.adds.map((add) => add.committeeIds)).toEqual([[MEDIA], [MEDIA]]);
  });

  it('refuses a row naming any other committee — existing, archived or unknown alike', () => {
    for (const name of ['لجنة التقنية', 'لجنة قديمة', 'لجنة لا وجود لها']) {
      const plan = buildImportPlan([row({ committeeNames: ['لجنة الإعلام', name] })], inMedia());
      expect(plan.rows[0]).toMatchObject({
        status: 'invalid',
        issues: [{ field: 'committees', code: 'committee_not_target', value: name }],
      });
      expect(plan.adds).toEqual([]);
    }
  });

  it('ignores the type cell, gives «عضو», and says so once for the file', () => {
    const plan = buildImportPlan(
      [
        row({ uniEmail: 's441000111@uqu.edu.sa', membershipTypeName: 'عضو فعال' }),
        row({ uniEmail: 's441000112@uqu.edu.sa', membershipTypeName: 'نوع لا وجود له' }),
      ],
      inMedia(),
    );
    expect(plan.rows.map((r) => r.status)).toEqual(['add', 'add']);
    expect(plan.adds.map((add) => add.membershipTypeId)).toEqual([TYPE_MEMBER, TYPE_MEMBER]);
    expect(plan.notices).toEqual(['membership_type_ignored']);
    // No type cells, nothing to say; and a club import never says it.
    expect(buildImportPlan([row()], inMedia()).notices).toEqual([]);
    expect(buildImportPlan([row({ membershipTypeName: 'عضو' })], clubState()).notices).toEqual([]);
  });

  it('joins an active member who is not in the committee, even with an empty cell', () => {
    const uniEmail = 's441000121@uqu.edu.sa';
    const plan = buildImportPlan([row({ uniEmail })], inMedia(membershipIn(uniEmail, false)));
    expect(plan.rows[0]).toMatchObject({ status: 'join', joinCommittees: ['لجنة الإعلام'] });
    expect(plan.joins).toEqual([
      { line: plan.rows[0]?.line, membershipId: MEMBERSHIP, committeeIds: [MEDIA] },
    ]);
  });

  it('skips an active member already in the committee, and restores a removed one into it', () => {
    const uniEmail = 's441000131@uqu.edu.sa';
    const existing = buildImportPlan(
      [row({ uniEmail })],
      inMedia(membershipIn(uniEmail, false, 'أحمد علي', [MEDIA])),
    );
    expect(existing.rows[0]?.status).toBe('existing');

    const restored = buildImportPlan(
      [row({ uniEmail, membershipTypeName: 'عضو فعال' })],
      inMedia(membershipIn(uniEmail, true)),
    );
    expect(restored.restores).toMatchObject([
      { membershipId: MEMBERSHIP, membershipTypeId: TYPE_MEMBER, committeeIds: [MEDIA] },
    ]);
  });

  it('has a checksum of its own, per committee', () => {
    line = 1;
    const club = buildImportPlan([row()], clubState()).checksum;
    line = 1;
    const media = buildImportPlan([row()], inMedia()).checksum;
    line = 1;
    const tech = buildImportPlan(
      [row()],
      clubState({ committee: { id: TECH, name: 'لجنة التقنية' } }),
    ).checksum;
    expect(new Set([club, media, tech]).size).toBe(3);
  });

  it('differs per committee even for a file in which no row writes', () => {
    const invalid = () => [
      row({ uniEmail: null, issues: [{ field: 'uniEmail', code: 'required' }] }),
    ];
    line = 1;
    const media = buildImportPlan(invalid(), inMedia()).checksum;
    line = 1;
    const tech = buildImportPlan(
      invalid(),
      clubState({ committee: { id: TECH, name: 'لجنة التقنية' } }),
    ).checksum;
    line = 1;
    const club = buildImportPlan(invalid(), clubState()).checksum;
    expect(new Set([club, media, tech]).size).toBe(3);
  });
});

describe('the «عضو» type', () => {
  it('is found by name, also when spelled differently, and missing is null', () => {
    expect(
      admissionTypeId([
        { id: TYPE_ACTIVE, name: 'عضو فعال' },
        { id: TYPE_MEMBER, name: ' عضو ' },
      ]),
    ).toBe(TYPE_MEMBER);
    expect(admissionTypeId([{ id: TYPE_ACTIVE, name: 'عضو فعال' }])).toBeNull();
  });
});
