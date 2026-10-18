import { expect, test, type Page } from '@playwright/test';

import type { ListMembersResponse, Member } from '@/shared/contracts/members';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The two screens added for the batch endpoints, against the real API: giving many members points
 * at once, and importing members from a CSV. What the screen reports must be what the database
 * then holds.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const balances = (page: Page) => page.getByRole('region', { name: /^أرصدة أعضاء / });

async function committeeMembers(page: Page, clubName: string, committee: string) {
  const query = new URLSearchParams({
    clubId: world.clubId(clubName),
    committeeId: world.committeeId(clubName, committee),
    pageSize: '100',
  });
  return (await ok<ListMembersResponse>(await apiAs(page).get(`/api/v1/members?${query}`))).items;
}

/** A member's points in one committee, read as the full admin. */
async function pointsIn(memberId: string, committeeId: string): Promise<number> {
  const member = await ok<Member>(await world.api.get(`/api/v1/members/${memberId}`));
  return member.committees.find((c) => c.id === committeeId)?.points ?? 0;
}

async function fillBatch(page: Page, amount: string, reason: string) {
  const dialog = page.getByRole('dialog').filter({ hasText: 'رصد' });
  await dialog.getByLabel(/عدد النقاط/).fill(amount);
  await dialog.getByLabel(/السبب/).fill(reason);
  return dialog;
}

test.describe('bulk points', () => {
  test('a lead gives several members of their committee the same points, and only them', async ({
    page,
  }) => {
    await actAs(page, persona.leadProgramming);
    const members = (await committeeMembers(page, club.computing, 'لجنة البرمجة')).slice(0, 3);
    const committeeId = world.committeeId(club.computing, 'لجنة البرمجة');
    const before = await Promise.all(members.map((m) => pointsIn(m.id, committeeId)));

    await page.goto('/dashboard/points');
    await expect(balances(page)).toBeVisible();
    // A lead is not offered the club-wide batch.
    await expect(page.getByRole('button', { name: 'رصد على مستوى النادي' })).toHaveCount(0);
    await page.getByRole('button', { name: 'رصد جماعي' }).click();
    const dialog = await fillBatch(page, '8', 'حضور اجتماع الفريق');
    await dialog.getByRole('checkbox', { name: members[0]?.user.fullName }).click();
    await dialog.getByRole('checkbox', { name: members[1]?.user.fullName }).click();
    await dialog.getByRole('button', { name: 'تسجيل النقاط لعضوين' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await pointsIn(members[0]?.id ?? '', committeeId)).toBe((before[0] ?? 0) + 8);
    expect(await pointsIn(members[1]?.id ?? '', committeeId)).toBe((before[1] ?? 0) + 8);
    expect(await pointsIn(members[2]?.id ?? '', committeeId)).toBe(before[2]);
  });

  test('a double tap on «تسجيل» gives the points once', async ({ page }) => {
    await actAs(page, persona.leadProgramming);
    const [member] = await committeeMembers(page, club.computing, 'لجنة البرمجة');
    const committeeId = world.committeeId(club.computing, 'لجنة البرمجة');
    const before = await pointsIn(member?.id ?? '', committeeId);

    await page.goto('/dashboard/points');
    await page.getByRole('button', { name: 'رصد جماعي' }).click();
    const dialog = await fillBatch(page, '5', 'نقرة مزدوجة');
    await dialog.getByRole('checkbox', { name: member?.user.fullName }).click();
    await dialog.getByRole('button', { name: 'تسجيل النقاط لعضو واحد' }).dblclick();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await pointsIn(member?.id ?? '', committeeId)).toBe(before + 5);
  });

  test('writes nothing when someone has left the committee, names them, and sends the rest', async ({
    page,
  }) => {
    await actAs(page, persona.officerComputing);
    const committeeId = world.committeeId(club.computing, 'لجنة التصميم');
    const members = (await committeeMembers(page, club.computing, 'لجنة التصميم')).slice(0, 2);
    const [stay, leave] = members as [Member, Member];
    const before = await pointsIn(stay.id, committeeId);

    await page.goto('/dashboard/points');
    await page.getByRole('combobox', { name: 'اللجنة' }).click();
    await page.getByRole('option', { name: /لجنة التصميم/ }).click();
    await expect(page.getByRole('region', { name: 'أرصدة أعضاء لجنة التصميم' })).toBeVisible();
    await page.getByRole('button', { name: 'رصد جماعي' }).click();
    const dialog = await fillBatch(page, '3', 'حضور ورشة');
    await dialog.getByRole('checkbox', { name: stay.user.fullName }).click();
    await dialog.getByRole('checkbox', { name: leave.user.fullName }).click();

    // Meanwhile the second one is taken out of the committee, by someone else.
    const removal = await world.api.delete(`/api/v1/members/${leave.id}/committees/${committeeId}`);
    expect(removal.ok()).toBe(true);

    await dialog.getByRole('button', { name: 'تسجيل النقاط لعضوين' }).click();
    await expect(dialog.getByText(/ولم يُسجَّل شيء/)).toBeVisible();
    await expect(dialog.getByText('ليس في هذه اللجنة')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: leave.user.fullName })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: stay.user.fullName })).toBeChecked();
    // Not even the member who was fine got anything.
    expect(await pointsIn(stay.id, committeeId)).toBe(before);

    await dialog.getByRole('button', { name: 'تسجيل النقاط لعضو واحد' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await pointsIn(stay.id, committeeId)).toBe(before + 3);
  });

  test('an officer gives a member in two committees points in both, with a warning', async ({
    page,
  }) => {
    await actAs(page, persona.officerComputing);
    const everyone = await world.allMembers(club.computing);
    const both = everyone.find((m) => m.committees.length >= 2);
    expect(both, 'a member of two committees in the demo').toBeDefined();
    const [a, b] = (both as Member).committees;
    const before = [
      await pointsIn((both as Member).id, a?.id ?? ''),
      await pointsIn((both as Member).id, b?.id ?? ''),
    ];

    await page.goto('/dashboard/points');
    await page.getByRole('button', { name: 'رصد على مستوى النادي' }).click();
    const dialog = await fillBatch(page, '2', 'حضور في اللجنتين');
    const name = (both as Member).user.fullName;
    await dialog.getByRole('checkbox', { name: `${name} · ${a?.name}` }).click();
    await dialog.getByRole('checkbox', { name: `${name} · ${b?.name}` }).click();
    await expect(dialog.getByRole('note')).toContainText('عضو واحد محدد في أكثر من لجنة');
    await dialog.getByRole('button', { name: 'تسجيل النقاط لعضوين' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await pointsIn((both as Member).id, a?.id ?? '')).toBe((before[0] ?? 0) + 2);
    expect(await pointsIn((both as Member).id, b?.id ?? '')).toBe((before[1] ?? 0) + 2);
  });
});

test.describe('CSV import', () => {
  const header = 'الاسم الكامل,البريد الجامعي,الجوال,نوع العضوية,اللجان';
  const stamp = () => Date.now().toString().slice(-7);

  async function openImport(page: Page) {
    await actAs(page, persona.officerComputing);
    await page.goto('/dashboard/members');
    await page.getByRole('button', { name: 'استيراد من ملف' }).click();
    await expect(page.getByRole('dialog', { name: 'استيراد أعضاء من ملف CSV' })).toBeVisible();
    // By role alone from here: the title (and so the accessible name) changes on the last step.
    return page.getByRole('dialog');
  }

  const upload = (dialog: ReturnType<Page['getByRole']>, text: string | Buffer) =>
    dialog.getByLabel('اختيار ملف').setInputFiles({
      name: 'members.csv',
      mimeType: 'text/csv',
      buffer: typeof text === 'string' ? Buffer.from(text, 'utf-8') : text,
    });

  test('previews every row, writes nothing, then imports exactly what was previewed', async ({
    page,
  }) => {
    const email = `s9${stamp()}@st.uqu.edu.sa`;
    const dialog = await openImport(page);
    await upload(
      dialog,
      [
        header,
        `عضو من الملف,${email},0501234567,عضو,لجنة البرمجة`,
        'بريد خاطئ,not-an-email,,,',
        `مكرر,${email},,,`,
      ].join('\n'),
    );
    await dialog.getByRole('button', { name: 'معاينة الملف' }).click();
    await expect(dialog.getByTestId('import-summary-add')).toHaveText('1');
    await expect(dialog.getByTestId('import-summary-invalid')).toHaveText('2');
    await expect(dialog.getByText(/مكرر: البريد نفسه في السطر 2/)).toBeVisible();

    // The preview saved nothing.
    const search = `/api/v1/members?q=${encodeURIComponent(email)}`;
    expect((await ok<ListMembersResponse>(await apiAs(page).get(search))).items).toEqual([]);

    await dialog.getByRole('button', { name: 'تأكيد استيراد شخص واحد' }).click();
    await expect(dialog.getByText('تم الاستيراد')).toBeVisible();
    await expect(dialog.getByText('أُضيف: 1')).toBeVisible();
    await dialog.getByRole('button', { name: 'تم' }).click();

    const found = (await ok<ListMembersResponse>(await apiAs(page).get(search))).items;
    expect(found.map((m) => [m.user.uniEmail, m.club.name, m.membershipType.name])).toEqual([
      [email, club.computing, 'عضو'],
    ]);
    expect(found[0]?.committees.map((c) => c.name)).toEqual(['لجنة البرمجة']);
    // The list behind the dialog refreshed too.
    await expect(page.getByRole('button', { name: 'فتح ملف عضو من الملف' })).toBeVisible();
  });

  test('a person already in the club is skipped and keeps their stored name', async ({ page }) => {
    const [existing] = (await world.allMembers(club.computing)).filter(
      (m) => m.user.uniEmail !== persona.officerComputing,
    );
    const dialog = await openImport(page);
    await upload(dialog, `${header}\nاسم آخر تماماً,${existing?.user.uniEmail},,,`);
    await dialog.getByRole('button', { name: 'معاينة الملف' }).click();
    await expect(dialog.getByTestId('import-summary-existing')).toHaveText('1');
    await expect(dialog.getByText(/الاسم المسجّل في النادي يختلف/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /لا يوجد صف صالح للاستيراد/ })).toBeDisabled();
    const after = await ok<Member>(await world.api.get(`/api/v1/members/${existing?.id}`));
    expect(after.user.fullName).toBe(existing?.user.fullName);
  });

  test('refuses a file that is not UTF-8, and one without the required column', async ({
    page,
  }) => {
    const dialog = await openImport(page);
    // Windows-1256 «أحمد»: what Excel writes for "CSV (Comma delimited)" on an Arabic Windows.
    await upload(dialog, Buffer.from([0xc3, 0xcd, 0xe3, 0xcf, 0x2c, 0xff]));
    await dialog.getByRole('button', { name: 'معاينة الملف' }).click();
    await expect(dialog.getByRole('alert')).toContainText('CSV UTF-8');

    await upload(dialog, 'الاسم الكامل,الجوال\nأحمد,0501234567');
    await dialog.getByRole('button', { name: 'معاينة الملف' }).click();
    await expect(dialog.getByRole('alert')).toContainText('ينقص الملف العمود «البريد الجامعي»');
  });

  test('the template link downloads the real file, with the Arabic headers', async ({ page }) => {
    const dialog = await openImport(page);
    const href = await dialog.getByRole('link', { name: 'تنزيل قالب الملف' }).getAttribute('href');
    const response = await apiAs(page).get(href ?? '');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('text/csv');
    const bytes = await response.body();
    // UTF-8 with a BOM, so Excel on Windows opens the Arabic headers correctly.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf-8')).toContain('الاسم الكامل');
  });

  test('a committee lead is offered no import, and the server refuses it too', async ({ page }) => {
    await actAs(page, persona.leadProgramming);
    await page.goto('/dashboard/members');
    await expect(page.getByRole('button', { name: /^فتح ملف / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'استيراد من ملف' })).toHaveCount(0);
    const response = await apiAs(page).post(
      `/api/v1/clubs/${world.clubId(club.computing)}/members/import/preview`,
      { file: Buffer.from(header).toString('base64') },
    );
    expect(response.status()).toBe(403);
  });
});
