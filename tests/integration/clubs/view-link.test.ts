import { beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import {
  disableCommitteeViewLink,
  getCommitteeViewLink,
  getPublicCommitteeView,
  rotateCommitteeViewLink,
} from '@/server/modules/clubs';
import { viewTokenSchema } from '@/shared/contracts/clubs';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectNotFound } from '@tests/utils/assertions';

/*
 * Managing a committee's view-only link (docs/adr/0023-committee-view-link.md): who may read it,
 * create it, renew it and turn it off, and what each of those does to the stored row.
 *
 * The public side of the same link lives in public-view.test.ts; it appears here only to prove
 * that a renewed or turned-off token stops working the moment the management call returns.
 */

let s: Scenario;
let archived: ArchivedScenario;

const noClient = { ip: null };

beforeAll(async () => {
  s = await buildScenario();
  archived = await buildArchivedScenario(s);
});

const NO_LINK = { url: null, token: null, createdAt: null };
const NO_TOKEN = { viewTokenHash: null, viewTokenCipher: null, viewTokenCreatedAt: null };

/** The stored columns, which no response ever shows. */
async function storedToken(committeeId: string) {
  return db.committee.findUniqueOrThrow({
    where: { id: committeeId },
    select: { viewTokenHash: true, viewTokenCipher: true, viewTokenCreatedAt: true },
  });
}

describe('who may manage a committee view link', () => {
  it('a full admin can, in any club', async () => {
    const actor = await actorFor(s.users.admin.id);
    const created = await rotateCommitteeViewLink(actor, s.committees.b1.id);
    expect(viewTokenSchema.safeParse(created.token).success).toBe(true);
    expect(await getCommitteeViewLink(actor, s.committees.b1.id)).toEqual(created);
    await disableCommitteeViewLink(actor, s.committees.b1.id);
  });

  it('an officer of the club can, for any of its committees', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const created = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    expect(await getCommitteeViewLink(actor, s.committees.a2.id)).toEqual(created);
    await disableCommitteeViewLink(actor, s.committees.a2.id);
  });

  it('the lead can, for the committee they lead', async () => {
    const actor = await actorFor(s.users.leadA1.id);
    const created = await rotateCommitteeViewLink(actor, s.committees.a1.id);
    expect(created.token).not.toBeNull();
    expect(await getCommitteeViewLink(actor, s.committees.a1.id)).toEqual(created);
  });

  it('a second lead of the same committee sees the link their colleague created', async () => {
    const lead = await actorFor(s.users.leadA1.id);
    const created = await rotateCommitteeViewLink(lead, s.committees.a1.id);
    const coLead = await actorFor(s.users.coLeadA1.id);
    expect(await getCommitteeViewLink(coLead, s.committees.a1.id)).toEqual(created);
  });

  it('a lead cannot reach another committee of their own club', async () => {
    const actor = await actorFor(s.users.leadA1.id);
    await expectNotFound(getCommitteeViewLink(actor, s.committees.a2.id));
    await expectNotFound(rotateCommitteeViewLink(actor, s.committees.a2.id));
    await expectNotFound(disableCommitteeViewLink(actor, s.committees.a2.id));
  });

  it('an officer cannot reach another club committee', async () => {
    const actor = await actorFor(s.users.officerB.id);
    await expectNotFound(getCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(rotateCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(disableCommitteeViewLink(actor, s.committees.a1.id));
  });

  it('a plain member of the committee sees no link at all', async () => {
    const actor = await actorFor(s.users.memberA1.id);
    await expectNotFound(getCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(rotateCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(disableCommitteeViewLink(actor, s.committees.a1.id));
  });

  it('a removed membership stale officer and lead roles grant nothing', async () => {
    const actor = await actorFor(s.users.removedOfficer.id);
    await expectNotFound(getCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(rotateCommitteeViewLink(actor, s.committees.a1.id));
  });

  it('a lead whose committee membership was removed keeps nothing', async () => {
    const actor = await actorFor(s.users.staleLead.id);
    await expectNotFound(getCommitteeViewLink(actor, s.committees.a1.id));
    await expectNotFound(rotateCommitteeViewLink(actor, s.committees.a1.id));
  });

  it('no refusal writes anything', async () => {
    const admin = await actorFor(s.users.admin.id);
    await rotateCommitteeViewLink(admin, s.committees.a2.id);
    const before = await storedToken(s.committees.a2.id);

    const member = await actorFor(s.users.memberA1.id);
    await expectNotFound(rotateCommitteeViewLink(member, s.committees.a2.id));
    await expectNotFound(disableCommitteeViewLink(member, s.committees.a2.id));
    const otherOfficer = await actorFor(s.users.officerB.id);
    await expectNotFound(rotateCommitteeViewLink(otherOfficer, s.committees.a2.id));

    expect(await storedToken(s.committees.a2.id)).toEqual(before);
    await disableCommitteeViewLink(admin, s.committees.a2.id);
  });
});

describe('create, renew and turn off', () => {
  it('a committee starts without a link', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const committee = await db.committee.create({
      data: { clubId: s.clubA.id, name: `لجنة بلا رابط ${String(Date.now())}` },
    });

    expect(await getCommitteeViewLink(actor, committee.id)).toEqual(NO_LINK);
    expect(await storedToken(committee.id)).toEqual(NO_TOKEN);
  });

  it('stores the token as an HMAC and an encrypted copy, never as it is sent', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const link = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    const stored = await storedToken(s.committees.a2.id);

    expect(stored.viewTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.viewTokenHash).not.toContain(link.token);
    expect(Buffer.from(stored.viewTokenCipher ?? []).toString('utf8')).not.toContain(link.token);
    expect(stored.viewTokenCreatedAt?.toISOString()).toBe(link.createdAt);
  });

  it('answers the whole URL under APP_ORIGIN', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const link = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    expect(link.url).toBe(`http://localhost/v/${String(link.token)}`);
  });

  it('renewing replaces the token, and the old one stops working at once', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const first = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    await expect(getPublicCommitteeView(String(first.token), noClient)).resolves.toBeDefined();

    const second = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    expect(second.token).not.toBe(first.token);
    await expectNotFound(getPublicCommitteeView(String(first.token), noClient));
    await expect(getPublicCommitteeView(String(second.token), noClient)).resolves.toBeDefined();
    expect(await getCommitteeViewLink(actor, s.committees.a2.id)).toEqual(second);
  });

  it('turning off leaves no link, and the token stops working', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const link = await rotateCommitteeViewLink(actor, s.committees.a2.id);

    await disableCommitteeViewLink(actor, s.committees.a2.id);
    expect(await getCommitteeViewLink(actor, s.committees.a2.id)).toEqual(NO_LINK);
    expect(await storedToken(s.committees.a2.id)).toEqual(NO_TOKEN);
    await expectNotFound(getPublicCommitteeView(String(link.token), noClient));
  });

  it('turning off twice is the same as turning off once', async () => {
    const actor = await actorFor(s.users.officerA.id);
    await rotateCommitteeViewLink(actor, s.committees.a2.id);
    await disableCommitteeViewLink(actor, s.committees.a2.id);
    await expect(disableCommitteeViewLink(actor, s.committees.a2.id)).resolves.toBeUndefined();
    expect(await storedToken(s.committees.a2.id)).toEqual(NO_TOKEN);
  });

  it('a committee can be given a new link after one was turned off', async () => {
    const actor = await actorFor(s.users.officerA.id);
    const first = await rotateCommitteeViewLink(actor, s.committees.a2.id);
    await disableCommitteeViewLink(actor, s.committees.a2.id);
    const second = await rotateCommitteeViewLink(actor, s.committees.a2.id);

    expect(second.token).not.toBe(first.token);
    await expectNotFound(getPublicCommitteeView(String(first.token), noClient));
    await expect(getPublicCommitteeView(String(second.token), noClient)).resolves.toBeDefined();
    await disableCommitteeViewLink(actor, s.committees.a2.id);
  });

  it('two committees never share a token', async () => {
    const actor = await actorFor(s.users.admin.id);
    const a = await rotateCommitteeViewLink(actor, s.committees.a1.id);
    const b = await rotateCommitteeViewLink(actor, s.committees.b1.id);

    expect(a.token).not.toBe(b.token);
    await disableCommitteeViewLink(actor, s.committees.b1.id);
  });
});

describe('archived clubs and committees', () => {
  it('an archived club refuses a new or renewed link', async () => {
    const actor = await actorFor(s.users.admin.id);
    await expectConflict(rotateCommitteeViewLink(actor, archived.z1.id), 'club_archived');
    expect(await storedToken(archived.z1.id)).toEqual(NO_TOKEN);
  });

  it('an archived committee of an active club refuses one too', async () => {
    const actor = await actorFor(s.users.officerA.id);
    await expectConflict(
      rotateCommitteeViewLink(actor, archived.archivedCommittee.id),
      'committee_archived',
    );
    expect(await storedToken(archived.archivedCommittee.id)).toEqual(NO_TOKEN);
  });

  it('turning off is refused as well, because the page is already closed', async () => {
    const admin = await actorFor(s.users.admin.id);
    // Give the committee a link, then archive it: the link is left behind, unreachable.
    const link = await rotateCommitteeViewLink(admin, s.committees.b1.id);
    await db.committee.update({
      where: { id: s.committees.b1.id },
      data: { archivedAt: new Date() },
    });

    await expectConflict(disableCommitteeViewLink(admin, s.committees.b1.id), 'committee_archived');
    expect((await storedToken(s.committees.b1.id)).viewTokenHash).not.toBeNull();
    await expectNotFound(getPublicCommitteeView(String(link.token), noClient));

    // Restoring the committee brings the same link back; the officer can renew it if they want.
    await db.committee.update({ where: { id: s.committees.b1.id }, data: { archivedAt: null } });
    await expect(getPublicCommitteeView(String(link.token), noClient)).resolves.toBeDefined();
    await disableCommitteeViewLink(admin, s.committees.b1.id);
  });

  it('the link stays readable while archived, so the lead can see what is out there', async () => {
    const officer = await actorFor(archived.users.officerZ.id);
    expect(await getCommitteeViewLink(officer, archived.z1.id)).toEqual(NO_LINK);
  });
});
