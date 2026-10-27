import { describe, expect, it } from 'vitest';

import type { Me } from '@/shared/contracts/auth';

import { clubsToAddTo, committeesToAddTo } from '../access';

/*
 * Which add the members page offers (docs/adr/0029-leads-add-members.md): the officers' add for a
 * club the person runs, a committee's add for each committee they lead anywhere else.
 */

const CLUB_A = { id: '0192d000-0000-7000-8000-00000000c1a0', name: 'نادي أ', slug: 'a' };
const CLUB_B = { id: '0192d000-0000-7000-8000-00000000c1b0', name: 'نادي ب', slug: 'b' };
const A1 = { id: '0192d000-0000-7000-8000-0000000000a1', name: 'لجنة أ1' };
const A2 = { id: '0192d000-0000-7000-8000-0000000000a2', name: 'لجنة أ2' };
const B1 = { id: '0192d000-0000-7000-8000-0000000000b1', name: 'لجنة ب1' };
const TYPE = { id: '0192d000-0000-7000-8000-0000000000f1', name: 'عضو' };

function me(overrides: Partial<Me> & { managed?: string[] }): Me {
  const { managed = [], ...rest } = overrides;
  return {
    user: {
      id: '0192d000-0000-7000-8000-0000000000e1',
      fullName: 'شخص',
      uniEmail: 's000000099@st.uqu.edu.sa',
      isFullAdmin: false,
    },
    memberships: [],
    access: {
      canAccessDashboard: true,
      canManageClubs: false,
      clubs: [CLUB_A, CLUB_B].map((club) => ({ ...club, canManage: managed.includes(club.id) })),
      committees: [],
    },
    ...rest,
  };
}

describe('committeesToAddTo', () => {
  it('lists the committees a lead leads, with their club, and not the ones they only belong to', () => {
    const lead = me({
      memberships: [
        {
          club: CLUB_A,
          role: 'MEMBER',
          membershipType: TYPE,
          committees: [
            { ...A1, role: 'LEAD' },
            { ...A2, role: 'MEMBER' },
          ],
        },
        {
          club: CLUB_B,
          role: 'MEMBER',
          membershipType: TYPE,
          committees: [{ ...B1, role: 'LEAD' }],
        },
      ],
    });
    expect(clubsToAddTo(lead)).toEqual([]);
    expect(committeesToAddTo(lead)).toEqual([
      { id: A1.id, name: A1.name, clubName: CLUB_A.name },
      { id: B1.id, name: B1.name, clubName: CLUB_B.name },
    ]);
  });

  it('leaves out a club the person runs, where the officers’ add does everything', () => {
    const officerAndLead = me({
      managed: [CLUB_A.id],
      memberships: [
        {
          club: CLUB_A,
          role: 'CLUB_OFFICER',
          membershipType: TYPE,
          committees: [{ ...A1, role: 'LEAD' }],
        },
      ],
    });
    expect(committeesToAddTo(officerAndLead)).toEqual([]);
  });

  it('is empty for a full admin and for a member who leads nothing', () => {
    expect(committeesToAddTo(me({ user: { ...me({}).user, isFullAdmin: true } }))).toEqual([]);
    expect(
      committeesToAddTo(
        me({
          memberships: [
            {
              club: CLUB_A,
              role: 'MEMBER',
              membershipType: TYPE,
              committees: [{ ...A1, role: 'MEMBER' }],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
