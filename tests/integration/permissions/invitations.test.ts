import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as resendCommitteeRoute } from '@/app/api/v1/members/[memberId]/committees/[committeeId]/role/invitation/route';
import { type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { emailSender } from '@/server/email';
import { clearSentEmails, sentEmails } from '@/server/email/dev';
import {
  getClubPermissions,
  resendClubInvitation,
  resendCommitteeInvitation,
  setMemberClubRole,
  setMemberCommitteeRole,
} from '@/server/modules/permissions';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';
import { APP_ORIGIN, callRoute } from '@tests/utils/route';

/*
 * Role invitations (docs/adr/0027-invite-only-sign-in.md): granting a role to someone who has not
 * signed in emails them an invitation; whoever may grant the role may resend it, three times a day
 * at most, counting only emails that went out.
 */

let s: Scenario;
let admin: Actor;
let officerA: Actor;
let officerB: Actor;
let leadA1: Actor;
let sequence = 0;

/** A person an officer added to club A (and committee A1) who has never signed in. */
async function addedToA1({ registered = false } = {}) {
  sequence += 1;
  const fullName = `مدعو ${sequence}`;
  const uniEmail = `s6${String(sequence).padStart(8, '0')}@st.uqu.edu.sa`;
  const user = await db.user.create({
    data: {
      fullName,
      searchName: normalizeForSearch(fullName),
      uniEmail,
      registeredAt: registered ? new Date() : null,
    },
  });
  const membership = await db.membership.create({
    data: { userId: user.id, clubId: s.clubA.id, membershipTypeId: s.types.a },
  });
  await db.committeeMembership.create({
    data: { membershipId: membership.id, committeeId: s.committees.a1.id, clubId: s.clubA.id },
  });
  return { userId: user.id, memberId: membership.id, uniEmail, fullName };
}

function emailsTo(address: string) {
  return sentEmails().filter((email) => email.to === address);
}

function invitationsOf(memberId: string) {
  return db.roleInvitation.findMany({
    where: { membershipId: memberId },
    orderBy: { sentAt: 'asc' },
  });
}

beforeAll(async () => {
  s = await buildScenario();
  [admin, officerA, officerB, leadA1] = await Promise.all([
    actorFor(s.users.admin.id),
    actorFor(s.users.officerA.id),
    actorFor(s.users.officerB.id),
    actorFor(s.users.leadA1.id),
  ]);
});

beforeEach(() => {
  clearSentEmails();
});

describe('the invitation that goes with a grant', () => {
  it('is sent once to an unregistered new officer, naming the role and the club', async () => {
    const person = await addedToA1();
    const result = await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');

    expect(result.invitation).toEqual({ status: 'sent', sentAt: expect.any(String) });
    const [email, ...others] = emailsTo(person.uniEmail);
    expect(others).toEqual([]);
    expect(email?.text).toContain('«مسؤول نادي»');
    expect(email?.text).toContain(`«${s.clubA.name}»`);
    expect(sentEmails()).toHaveLength(1);
    expect(await invitationsOf(person.memberId)).toEqual([
      expect.objectContaining({ clubId: s.clubA.id, committeeId: null, sentById: admin.userId }),
    ]);
  });

  it('is sent to an unregistered new lead, naming the committee and its club', async () => {
    const person = await addedToA1();
    const result = await setMemberCommitteeRole(
      officerA,
      person.memberId,
      s.committees.a1.id,
      'LEAD',
    );

    expect(result.invitation?.status).toBe('sent');
    const [email] = emailsTo(person.uniEmail);
    expect(email?.text).toContain('«مسؤول لجنة»');
    expect(email?.text).toContain(`«${s.committees.a1.name}»`);
    expect(email?.text).toContain(`«${s.clubA.name}»`);
    expect(await invitationsOf(person.memberId)).toEqual([
      expect.objectContaining({ committeeId: s.committees.a1.id, sentById: officerA.userId }),
    ]);
  });

  it('carries no secret: the link is the login page, with nothing in the URL', async () => {
    const person = await addedToA1();
    await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
    const [email] = emailsTo(person.uniEmail);
    if (!email) throw new Error('no invitation was sent');

    const links = [...email.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(links).toEqual([`${APP_ORIGIN}/login`]);
    const urls = [...`${email.html} ${email.text}`.matchAll(/https?:\/\/[^\s"<]+/g)].map(
      (match) => match[0],
    );
    expect(new Set(urls)).toEqual(new Set([`${APP_ORIGIN}/login`]));
    for (const url of urls) {
      expect(url).not.toContain(encodeURIComponent(person.uniEmail));
      expect(url).not.toContain(person.uniEmail);
    }
    // Nothing that looks like a token anywhere in it.
    expect(`${email.html} ${email.text}`).not.toMatch(/[A-Za-z0-9_-]{24,}/);
    // The page and the plain text say how to sign in, about the junk folder, and to ignore it.
    expect(email.text).toContain('ببريدك الجامعي');
    expect(email.text).toContain('Junk');
    expect(email.text).toContain('تجاهل');
    expect(email.html).toContain('dir="rtl"');
  });

  it('is not sent to someone who has signed in before', async () => {
    const person = await addedToA1({ registered: true });
    const officer = await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
    const lead = await setMemberCommitteeRole(admin, person.memberId, s.committees.a1.id, 'LEAD');
    expect([officer.invitation, lead.invitation]).toEqual([null, null]);
    expect(sentEmails()).toEqual([]);
    expect(await invitationsOf(person.memberId)).toEqual([]);
  });

  it('is not sent for a revoke or for a role they already hold', async () => {
    const person = await addedToA1();
    await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
    clearSentEmails();

    expect((await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER')).invitation).toBeNull();
    expect((await setMemberClubRole(admin, person.memberId, 'MEMBER')).invitation).toBeNull();
    expect(sentEmails()).toEqual([]);
    expect(await invitationsOf(person.memberId)).toHaveLength(1);
  });

  it('still grants the role when the email fails, and says so', async () => {
    const person = await addedToA1();
    vi.spyOn(emailSender, 'send').mockRejectedValueOnce(
      new Error('Resend refused the email (HTTP 503).'),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await setMemberCommitteeRole(
        officerA,
        person.memberId,
        s.committees.a1.id,
        'LEAD',
      );
      expect(result.invitation).toEqual({ status: 'failed' });
      expect(result.member.committees).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: s.committees.a1.id, role: 'LEAD' })]),
      );
      expect(
        await db.committeeMembership.findFirstOrThrow({
          where: { membershipId: person.memberId, committeeId: s.committees.a1.id },
        }),
      ).toMatchObject({ role: 'LEAD' });
      expect(await invitationsOf(person.memberId)).toEqual([]);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(person.uniEmail);
      expect(JSON.stringify(logged.mock.calls)).toContain(person.memberId);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('resending', () => {
  it('is allowed to whoever may grant the role', async () => {
    const officer = await addedToA1();
    await setMemberClubRole(admin, officer.memberId, 'CLUB_OFFICER');
    await expect(resendClubInvitation(admin, officer.memberId)).resolves.toEqual({
      sentAt: expect.any(String),
    });

    const lead = await addedToA1();
    await setMemberCommitteeRole(officerA, lead.memberId, s.committees.a1.id, 'LEAD');
    await resendCommitteeInvitation(officerA, lead.memberId, s.committees.a1.id);
    await resendCommitteeInvitation(admin, lead.memberId, s.committees.a1.id);

    expect(emailsTo(officer.uniEmail)).toHaveLength(2);
    expect(emailsTo(lead.uniEmail)).toHaveLength(3);
    expect(await invitationsOf(lead.memberId)).toHaveLength(3);
  });

  it('is refused to anyone else, and sends and records nothing', async () => {
    const officer = await addedToA1();
    await setMemberClubRole(admin, officer.memberId, 'CLUB_OFFICER');
    const lead = await addedToA1();
    await setMemberCommitteeRole(officerA, lead.memberId, s.committees.a1.id, 'LEAD');
    clearSentEmails();
    const before = await db.roleInvitation.count();

    // An officer cannot appoint officers, so cannot resend their invitation.
    await expectForbidden(resendClubInvitation(officerA, officer.memberId), 'full_admin_required');
    // A lead sees the people of their committee but grants nothing.
    await expectForbidden(resendClubInvitation(leadA1, officer.memberId), 'full_admin_required');
    await expectForbidden(
      resendCommitteeInvitation(leadA1, lead.memberId, s.committees.a1.id),
      'club_management_required',
    );
    // Another club's officer cannot see them at all.
    await expectNotFound(resendClubInvitation(officerB, officer.memberId));
    await expectNotFound(resendCommitteeInvitation(officerB, lead.memberId, s.committees.a1.id));

    expect(sentEmails()).toEqual([]);
    expect(await db.roleInvitation.count()).toBe(before);
  });

  it('is refused for someone who has signed in, or who holds no such role', async () => {
    const registered = await addedToA1({ registered: true });
    await setMemberClubRole(admin, registered.memberId, 'CLUB_OFFICER');
    await setMemberCommitteeRole(admin, registered.memberId, s.committees.a1.id, 'LEAD');
    await expectConflict(resendClubInvitation(admin, registered.memberId), 'already_registered');
    await expectConflict(
      resendCommitteeInvitation(officerA, registered.memberId, s.committees.a1.id),
      'already_registered',
    );

    const roleless = await addedToA1();
    await expectConflict(resendClubInvitation(admin, roleless.memberId), 'no_role');
    await expectConflict(
      resendCommitteeInvitation(officerA, roleless.memberId, s.committees.a1.id),
      'no_role',
    );
    await expectConflict(
      resendCommitteeInvitation(officerA, roleless.memberId, s.committees.a2.id),
      'not_in_committee',
    );

    expect(sentEmails()).toEqual([]);
    expect(await invitationsOf(roleless.memberId)).toEqual([]);
  });

  it('allows three invitations a day, the automatic one included; the fourth is a 429', async () => {
    const person = await addedToA1();
    await setMemberCommitteeRole(officerA, person.memberId, s.committees.a1.id, 'LEAD');
    await resendCommitteeInvitation(officerA, person.memberId, s.committees.a1.id);
    await resendCommitteeInvitation(admin, person.memberId, s.committees.a1.id);

    const fourth = await callRoute(resendCommitteeRoute, {
      method: 'POST',
      path: `/api/v1/members/${person.memberId}/committees/${s.committees.a1.id}/role/invitation`,
      params: { memberId: person.memberId, committeeId: s.committees.a1.id },
      actor: s.users.officerA.uniEmail,
    });
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as {
      error: { reason: string; retryAfterSeconds: number };
    };
    expect(body.error.reason).toBe('too_many_invitations');
    expect(Number(fourth.headers.get('retry-after'))).toBe(body.error.retryAfterSeconds);
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error.retryAfterSeconds).toBeLessThanOrEqual(24 * 60 * 60);

    expect(emailsTo(person.uniEmail)).toHaveLength(3);
    expect(await invitationsOf(person.memberId)).toHaveLength(3);
  });

  it('reports the limit on a grant without refusing the grant', async () => {
    const person = await addedToA1();
    await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
    await resendClubInvitation(admin, person.memberId);
    await resendClubInvitation(admin, person.memberId);

    const lead = await setMemberCommitteeRole(admin, person.memberId, s.committees.a1.id, 'LEAD');
    expect(lead.invitation).toEqual({ status: 'limited', retryAfterSeconds: expect.any(Number) });
    expect(lead.member.committees).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: s.committees.a1.id, role: 'LEAD' })]),
    );
    expect(emailsTo(person.uniEmail)).toHaveLength(3);
  });

  it('does not count emails that failed', async () => {
    const person = await addedToA1();
    vi.spyOn(emailSender, 'send').mockRejectedValueOnce(new Error('HTTP 503'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const grant = await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
      expect(grant.invitation).toEqual({ status: 'failed' });

      // A resend that fails reaches the route wrapper, which logs it and answers 500.
      vi.spyOn(emailSender, 'send').mockRejectedValueOnce(new Error('HTTP 503'));
      await expect(resendClubInvitation(admin, person.memberId)).rejects.toThrow('HTTP 503');
    } finally {
      logged.mockRestore();
    }

    for (let sent = 0; sent < 3; sent += 1) {
      await expect(resendClubInvitation(admin, person.memberId)).resolves.toBeDefined();
    }
    await expect(resendClubInvitation(admin, person.memberId)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      reason: 'too_many_invitations',
    });
    expect(emailsTo(person.uniEmail)).toHaveLength(3);
  });

  it('starts again the next UTC day', async () => {
    const person = await addedToA1();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-01T20:00:00Z'));
      await setMemberClubRole(admin, person.memberId, 'CLUB_OFFICER');
      await resendClubInvitation(admin, person.memberId);
      await resendClubInvitation(admin, person.memberId);
      await expect(resendClubInvitation(admin, person.memberId)).rejects.toMatchObject({
        retryAfterSeconds: 4 * 60 * 60,
      });

      vi.setSystemTime(new Date('2026-11-02T00:00:01Z'));
      await expect(resendClubInvitation(admin, person.memberId)).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('who holds which role', () => {
  it("never shows another club's invitations (ADR 0012)", async () => {
    const person = await addedToA1();
    const inB = await db.membership.create({
      data: { userId: person.userId, clubId: s.clubB.id, membershipTypeId: s.types.b },
    });
    await db.committeeMembership.create({
      data: { membershipId: inB.id, committeeId: s.committees.b1.id, clubId: s.clubB.id },
    });
    // Club B invites them; in club A they hold a role nobody invited them to.
    await setMemberCommitteeRole(officerB, inB.id, s.committees.b1.id, 'LEAD');
    await db.membership.update({ where: { id: person.memberId }, data: { role: 'CLUB_OFFICER' } });

    const { officers } = await getClubPermissions(officerA, s.clubA.id);
    expect(officers.find((holder) => holder.memberId === person.memberId)).toMatchObject({
      registered: false,
      invitedAt: null,
    });
  });

  it('says who has not signed in and when this club last invited them', async () => {
    const invited = await addedToA1();
    await setMemberClubRole(admin, invited.memberId, 'CLUB_OFFICER');
    const [row] = await invitationsOf(invited.memberId);
    const registered = await addedToA1({ registered: true });
    await setMemberCommitteeRole(admin, registered.memberId, s.committees.a1.id, 'LEAD');

    const { officers, leads } = await getClubPermissions(officerA, s.clubA.id);
    expect(officers.find((holder) => holder.memberId === invited.memberId)).toMatchObject({
      registered: false,
      invitedAt: row?.sentAt.toISOString(),
    });
    expect(leads.find((holder) => holder.memberId === registered.memberId)).toMatchObject({
      registered: true,
      invitedAt: null,
    });
    // Someone who holds a role from before invitations existed: not registered, never invited.
    const unregisteredLead = await addedToA1();
    await db.committeeMembership.updateMany({
      where: { membershipId: unregisteredLead.memberId },
      data: { role: 'LEAD' },
    });
    const again = await getClubPermissions(admin, s.clubA.id);
    expect(
      again.leads.find((holder) => holder.memberId === unregisteredLead.memberId),
    ).toMatchObject({ registered: false, invitedAt: null });
  });
});
