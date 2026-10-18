// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/client/lib/api-client';
import { CLUB_POINTS_BULK_MAX, COMMITTEE_POINTS_BULK_MAX } from '@/shared/contracts/points';
import { renderWithProviders } from '@tests/utils/render';

import {
  BulkPointsDialog,
  type BulkGroup,
  type BulkPointsDialogProps,
} from '../bulk-points-dialog';

/*
 * The batch dialog on its own, with the request replaced by a spy: what it sends (amount sign,
 * batch id, the pairs in list order), when it refuses to send, and what it does with the server's
 * answers. The screens built on it are covered against the mock API in bulk-points.test.tsx.
 */

beforeAll(() => {
  // Radix measures its content; jsdom has no ResizeObserver or pointer capture.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

type Request = Parameters<BulkPointsDialogProps['onSubmit']>[0];

/** `count` members with distinct ids; `offset` keeps the ids of different groups apart. */
const members = (count: number, prefix = 'عضو', offset = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + offset).padStart(12, '0')}`,
    fullName: `${prefix} ${index + 1}`,
  }));

const programming = { id: '11111111-1111-4111-8111-111111111111', name: 'لجنة البرمجة' };
const design = { id: '22222222-2222-4222-8222-222222222222', name: 'لجنة التصميم' };

function renderDialog(options: {
  kind?: 'committee' | 'club';
  groups?: BulkGroup[];
  onSubmit?: BulkPointsDialogProps['onSubmit'];
}) {
  const onSubmit =
    options.onSubmit ??
    vi.fn(async (request: Request) => ({
      batchId: request.batchId,
      count: request.pairs.length,
      transactionIds: [],
      byCommittee: [],
    }));
  const onOpenChange = vi.fn();
  renderWithProviders(
    <BulkPointsDialog
      open
      onOpenChange={onOpenChange}
      kind={options.kind ?? 'committee'}
      name="لجنة البرمجة"
      groups={options.groups ?? [{ committee: programming, members: members(5) }]}
      onSubmit={onSubmit}
    />,
  );
  return { user: userEvent.setup(), onSubmit: onSubmit as ReturnType<typeof vi.fn>, onOpenChange };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
  reason = 'حضور ورشة',
) {
  await user.type(screen.getByLabelText(/عدد النقاط/), amount);
  await user.type(screen.getByLabelText(/السبب/), reason);
}

const submitButton = () => screen.getByRole('button', { name: /^تسجيل النقاط/ });

describe('BulkPointsDialog — what it sends', { timeout: 20_000 }, () => {
  it('sends the ticked members, in list order, with the same points for each', async () => {
    const { user, onSubmit } = renderDialog({});
    // Ticked out of order: the request still follows the list.
    await user.click(screen.getByRole('checkbox', { name: 'عضو 4' }));
    await user.click(screen.getByRole('checkbox', { name: 'عضو 2' }));
    await fill(user, '12', '  حضور   ورشة  ');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const request = onSubmit.mock.calls[0]?.[0] as Request;
    expect(request.pairs.map((pair) => pair.memberId.slice(-1))).toEqual(['1', '3']);
    expect(request.pairs.every((pair) => pair.committeeId === programming.id)).toBe(true);
    expect(request.amount).toBe(12);
    // The server collapses whitespace itself; the dialog sends what the person typed, trimmed of
    // nothing it is not allowed to change.
    expect(request.reason).toBe('حضور ورشة');
    expect(request.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(request.batchId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends a deduction as a negative amount', async () => {
    const { user, onSubmit } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await user.click(screen.getByRole('button', { name: 'خصم' }));
    await fill(user, '3');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit.mock.calls[0]?.[0] as Request).amount).toBe(-3);
  });

  it('turns Arabic-Indic digits into the number', async () => {
    const { user, onSubmit } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '٢٥');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit.mock.calls[0]?.[0] as Request).amount).toBe(25);
  });

  it('sends nothing for a missing, zero or too-large amount, or an empty reason', async () => {
    const { user, onSubmit } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await user.click(submitButton());
    for (const [amount, reason] of [
      ['0', 'سبب'],
      ['1001', 'سبب'],
      ['5', '   '],
      ['1.5', 'سبب'],
    ]) {
      await user.clear(screen.getByLabelText(/عدد النقاط/));
      await user.clear(screen.getByLabelText(/السبب/));
      await user.type(screen.getByLabelText(/عدد النقاط/), amount ?? '');
      if (reason?.trim()) await user.type(screen.getByLabelText(/السبب/), reason);
      else await user.type(screen.getByLabelText(/السبب/), reason ?? '');
      await user.click(submitButton());
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('will not send with nobody ticked', async () => {
    const { onSubmit } = renderDialog({});
    expect(submitButton().hasAttribute('disabled')).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('BulkPointsDialog — the limits', { timeout: 30_000 }, () => {
  it(`refuses more than ${COMMITTEE_POINTS_BULK_MAX} members in a committee batch`, async () => {
    const { user, onSubmit } = renderDialog({
      groups: [{ committee: programming, members: members(COMMITTEE_POINTS_BULK_MAX + 1) }],
    });
    await user.click(screen.getByRole('button', { name: 'تحديد الظاهرين' }));
    await fill(user, '1');
    await user.click(submitButton());
    expect(
      await screen.findByText(`الحد الأقصى ${COMMITTEE_POINTS_BULK_MAX} في الطلب الواحد.`),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it(`allows exactly ${COMMITTEE_POINTS_BULK_MAX}`, async () => {
    const { user, onSubmit } = renderDialog({
      groups: [{ committee: programming, members: members(COMMITTEE_POINTS_BULK_MAX) }],
    });
    await user.click(screen.getByRole('button', { name: 'تحديد الظاهرين' }));
    await fill(user, '1');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0]?.[0] as Request).pairs).toHaveLength(COMMITTEE_POINTS_BULK_MAX);
  });

  it(`a club batch goes up to ${CLUB_POINTS_BULK_MAX} pairs, across committees`, () => {
    // The two limits differ on purpose (ADR 0022); the dialog reads them from the contract.
    expect(CLUB_POINTS_BULK_MAX).toBeGreaterThan(COMMITTEE_POINTS_BULK_MAX);
  });
});

describe('BulkPointsDialog — choosing members', { timeout: 20_000 }, () => {
  it('keeps what was ticked while the search narrows the list', async () => {
    const { user } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await user.type(screen.getByRole('searchbox', { name: 'ابحث في الأعضاء' }), 'عضو 3');
    expect(screen.queryByRole('checkbox', { name: 'عضو 1' })).toBeNull();
    // The count is of everything ticked, not of what is visible.
    expect(screen.getByText('1 من 5 محدد')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByRole('checkbox', { name: 'عضو 1' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('says so when the search matches nobody, and when the committee has nobody', async () => {
    const { user } = renderDialog({});
    await user.type(screen.getByRole('searchbox'), 'لا أحد');
    expect(screen.getByText('لا أحد بهذا الاسم.')).toBeTruthy();
  });

  it('shows an empty committee as empty', () => {
    renderDialog({ groups: [{ committee: programming, members: [] }] });
    expect(screen.getByText('لا يوجد أعضاء في هذه اللجنة.')).toBeTruthy();
    expect(submitButton().hasAttribute('disabled')).toBe(true);
  });

  it('selects only what the search shows, and a committee checkbox only that committee', async () => {
    const { user } = renderDialog({
      kind: 'club',
      groups: [
        { committee: programming, members: members(3, 'برمجة') },
        { committee: design, members: members(3, 'تصميم') },
      ],
    });
    await user.click(screen.getByRole('checkbox', { name: 'تحديد كل أعضاء لجنة التصميم' }));
    expect(
      within(screen.getByRole('group', { name: 'لجنة التصميم' })).getAllByRole('checkbox', {
        checked: true,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByRole('group', { name: 'لجنة البرمجة' })).queryAllByRole('checkbox', {
        checked: true,
      }),
    ).toHaveLength(0);
    expect(screen.getByText('3 من 6 محدد')).toBeTruthy();
    // Unticking one member makes the committee's own box partly ticked.
    await user.click(screen.getByRole('checkbox', { name: 'تصميم 1 · لجنة التصميم' }));
    expect(
      screen
        .getByRole('checkbox', { name: 'تحديد كل أعضاء لجنة التصميم' })
        .getAttribute('aria-checked'),
    ).toBe('mixed');
  });

  it('counts a member ticked in two committees once in the warning, and twice in the batch', async () => {
    const shared = members(1, 'مشترك');
    const { user, onSubmit } = renderDialog({
      kind: 'club',
      groups: [
        { committee: programming, members: [...shared, ...members(2, 'برمجة', 100)] },
        { committee: design, members: shared },
      ],
    });
    await user.click(screen.getByRole('checkbox', { name: 'مشترك 1 · لجنة البرمجة' }));
    expect(screen.queryByRole('note')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'مشترك 1 · لجنة التصميم' }));
    expect(screen.getByRole('note').textContent).toContain('عضو واحد محدد في أكثر من لجنة');
    await fill(user, '2');
    await user.click(screen.getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const pairs = (onSubmit.mock.calls[0]?.[0] as Request).pairs;
    expect(pairs.map((pair) => pair.committeeId).sort()).toEqual(
      [programming.id, design.id].sort(),
    );
    expect(new Set(pairs.map((pair) => pair.memberId)).size).toBe(1);
  });
});

describe('BulkPointsDialog — the batch id', { timeout: 20_000 }, () => {
  const networkDown = (_request: Request) =>
    Promise.reject<never>(new ApiError(0, 'NETWORK', 'down'));

  it('keeps the same id when the same request is sent again after a failure', async () => {
    const onSubmit = vi.fn(networkDown);
    const { user } = renderDialog({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '4');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    // A retry after a response that may have been lost: the server answers it from the first.
    expect(onSubmit.mock.calls[1]?.[0].batchId).toBe(onSubmit.mock.calls[0]?.[0].batchId);
  });

  it('takes a new id as soon as anything in the request changes', async () => {
    const onSubmit = vi.fn(networkDown);
    const { user } = renderDialog({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '4');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('checkbox', { name: 'عضو 2' }));
    await user.click(screen.getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0].batchId).not.toBe(onSubmit.mock.calls[0]?.[0].batchId);

    await user.type(screen.getByLabelText(/السبب/), ' إضافية');
    await user.click(screen.getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[0].batchId).not.toBe(onSubmit.mock.calls[1]?.[0].batchId);
  });

  it('sends once for a double click', async () => {
    let release: () => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          release = () => reject(new ApiError(0, 'NETWORK', 'down'));
        }),
    );
    const { user } = renderDialog({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '4');
    await user.dblClick(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });
});

describe('BulkPointsDialog — what the server says', { timeout: 20_000 }, () => {
  const rejection = (...rejected: Array<[number, string]>) =>
    new ApiError(422, 'VALIDATION_FAILED', 'rejected', {
      reason: 'entries_rejected',
      issues: rejected.map(([index, code]) => ({
        path: ['body', 'memberIds', index],
        code,
        message: code,
      })),
    });

  it('unticks exactly the rejected members, names each reason, and keeps the rest ticked', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(rejection([0, 'member_removed'], [2, 'not_in_committee']));
    const { user } = renderDialog({ onSubmit });
    for (const name of ['عضو 1', 'عضو 2', 'عضو 3', 'عضو 4']) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await fill(user, '2');
    await user.click(screen.getByRole('button', { name: 'تسجيل النقاط لـ 4 أعضاء' }));

    expect(await screen.findByText(/تعذّر تسجيل النقاط لعضوين/)).toBeTruthy();
    const state = (name: string) =>
      screen.getByRole('checkbox', { name }).getAttribute('aria-checked');
    expect([state('عضو 1'), state('عضو 2'), state('عضو 3'), state('عضو 4')]).toEqual([
      'false',
      'true',
      'false',
      'true',
    ]);
    expect(screen.getByText('مُزال من النادي')).toBeTruthy();
    expect(screen.getByText('ليس في هذه اللجنة')).toBeTruthy();
    // The dialog stays open for another go.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reads the index of a pair in a club batch, and says so for a code it does not know', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(
      new ApiError(422, 'VALIDATION_FAILED', 'rejected', {
        reason: 'entries_rejected',
        issues: [
          { path: ['body', 'entries', 1, 'committeeId'], code: 'something_new', message: 'x' },
        ],
      }),
    );
    const { user } = renderDialog({
      kind: 'club',
      onSubmit,
      groups: [{ committee: programming, members: members(3) }],
    });
    for (const name of ['عضو 1 · لجنة البرمجة', 'عضو 2 · لجنة البرمجة']) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await fill(user, '2');
    await user.click(screen.getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    expect(await screen.findByText('لا يمكن رصد نقاط له')).toBeTruthy();
    // The second pair in the request was the second ticked one.
    expect(
      screen.getByRole('checkbox', { name: 'عضو 2 · لجنة البرمجة' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('checkbox', { name: 'عضو 1 · لجنة البرمجة' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows a refusal that is not about members as an alert and keeps the selection', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, 'CONFLICT', 'archived', { reason: 'committee_archived' }),
      );
    const { user } = renderDialog({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '2');
    await user.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'اللجنة مؤرشفة، فلا يمكن إضافة شيء جديد إليها.',
    );
    expect(screen.getByRole('checkbox', { name: 'عضو 1' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('closes after success', async () => {
    const { user, onOpenChange } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await fill(user, '2');
    await user.click(submitButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('closes from «إلغاء» without sending anything', async () => {
    const { user, onSubmit, onOpenChange } = renderDialog({});
    await user.click(screen.getByRole('checkbox', { name: 'عضو 1' }));
    await user.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
