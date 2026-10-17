import type { Club, Committee } from '@/shared/contracts/clubs';
import type { ListMembersResponse, Member } from '@/shared/contracts/members';

import { adminApi, ok } from './personas';

/**
 * Ids of the seeded clubs, committees and members, read through the API as the full admin, so
 * the tests name things the way the README does ("Computing / البرمجة") rather than by UUID.
 */
export async function loadWorld() {
  const api = await adminApi();
  const clubs = await ok<{ items: Club[] }>(await api.get('/api/v1/clubs'));
  const clubId = (name: string) => {
    const found = clubs.items.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`No club named ${name}`);
    return found.id;
  };
  const committees = new Map<string, Committee[]>();
  for (const club of clubs.items) {
    committees.set(
      club.id,
      (await ok<{ items: Committee[] }>(await api.get(`/api/v1/clubs/${club.id}/committees`)))
        .items,
    );
  }
  const committeeId = (clubName: string, name: string) => {
    const found = committees.get(clubId(clubName))?.find((c) => c.name === name);
    if (!found) throw new Error(`No committee ${clubName} / ${name}`);
    return found.id;
  };

  /** A person's membership in a club (active or removed). */
  const member = async (uniEmail: string, clubName: string): Promise<Member> => {
    const query = new URLSearchParams({ q: uniEmail, clubId: clubId(clubName), status: 'all' });
    const list = await ok<ListMembersResponse>(await api.get(`/api/v1/members?${query}`));
    const found = list.items.find((item) => item.user.uniEmail === uniEmail);
    if (!found) throw new Error(`${uniEmail} has no membership in ${clubName}`);
    return found;
  };

  /** Every active member the full admin sees, optionally in one club. */
  const allMembers = async (clubName?: string): Promise<Member[]> => {
    const query = new URLSearchParams({ pageSize: '100' });
    if (clubName) query.set('clubId', clubId(clubName));
    return (await ok<ListMembersResponse>(await api.get(`/api/v1/members?${query}`))).items;
  };

  return { api, clubs: clubs.items, clubId, committeeId, member, allMembers };
}

export type World = Awaited<ReturnType<typeof loadWorld>>;
