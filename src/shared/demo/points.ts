import { addDays } from '@/shared/lib/dates';

import { demoClubs, demoPeople, type DemoClubKey } from './demo';
import { createRandom, demoId } from './ids';

/*
 * Deterministic point transactions for the demo dataset, spread over the last ~6 months relative
 * to `today`. Same input → same output, so the seed and the mocks agree. Includes bulk entries
 * (shared batch id), deductions, edited transactions (with a revision) and cancelled ones.
 */

export interface DemoTransaction {
  id: string;
  personKey: string;
  clubKey: DemoClubKey;
  committeeKey: string;
  amount: number;
  reason: string;
  workDate: string;
  /** Days after the work date that it was recorded. */
  recordedAfterDays: number;
  createdByKey: string;
  batchId: string | null;
  /** Edited once: these were the values before the edit. */
  edit?: { previousAmount: number; previousReason: string; byKey: string };
  cancellation?: { reason: string; byKey: string };
}

const POSITIVE_REASONS = [
  'حضور ورشة Git وGitHub',
  'تقديم جلسة تعريفية عن بايثون',
  'المشاركة في تنظيم هاكاثون مكة',
  'تصميم هوية فعالية اليوم العالمي للبرمجة',
  'كتابة محتوى تقني لحساب النادي',
  'تصوير فعالية ملتقى الأمن السيبراني',
  'إنجاز مهمة اللجنة قبل الموعد',
  'حضور الاجتماع الدوري للجنة',
  'المشاركة في معسكر تطوير الويب',
  'تنسيق زيارة لشركة تقنية',
  'مراجعة كود مشروع النادي',
  'إعداد عرض ورشة الذكاء الاصطناعي',
  'تقديم ورشة مقدمة في تصميم الواجهات',
  'إدارة التسجيل في فعالية النادي',
  'نشر تغطية فعالية على منصات النادي',
] as const;

const NEGATIVE_REASONS = [
  'غياب عن الاجتماع الدوري دون عذر',
  'تأخر في تسليم مهمة اللجنة',
  'عدم الحضور بعد التسجيل في الفعالية',
] as const;

const CANCELLATION_REASONS = ['أُضيفت بالخطأ', 'تكررت مع عملية سابقة'] as const;

const POSITIVE_AMOUNTS = [5, 10, 10, 15, 20, 25] as const;
const NEGATIVE_AMOUNTS = [-3, -5] as const;

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

interface CommitteeRoster {
  clubKey: DemoClubKey;
  committeeKey: string;
  members: Array<{ personKey: string; removedDaysAgo: number | null }>;
  leadKey: string | null;
  officerKey: string | null;
}

function rosters(): CommitteeRoster[] {
  return demoClubs.flatMap((club) =>
    club.committees.map((committee) => {
      const members: CommitteeRoster['members'] = [];
      let leadKey: string | null = null;
      for (const person of demoPeople) {
        const membership = person.memberships.find((m) => m.club === club.key);
        const committeeMembership = membership?.committees.find((c) => c.key === committee.key);
        if (!membership || !committeeMembership) continue;
        members.push({ personKey: person.key, removedDaysAgo: membership.removedDaysAgo ?? null });
        if (committeeMembership.lead && !membership.removedDaysAgo) leadKey ??= person.key;
      }
      const officer = demoPeople.find((person) =>
        person.memberships.some((m) => m.club === club.key && m.officer && !m.removedDaysAgo),
      );
      return {
        clubKey: club.key,
        committeeKey: committee.key,
        members,
        leadKey,
        officerKey: officer?.key ?? null,
      };
    }),
  );
}

export function generateDemoTransactions(today: string): DemoTransaction[] {
  const random = createRandom(20_261_010);
  const transactions: DemoTransaction[] = [];
  let counter = 0;

  for (const roster of rosters()) {
    const recorder = (personKey: string) =>
      (roster.leadKey && roster.leadKey !== personKey ? roster.leadKey : roster.officerKey) ??
      'abdullah';
    const supervisor = roster.officerKey ?? 'abdullah';

    // One bulk entry per committee: everyone attended the welcome meeting ~150 days ago.
    const batchKey = `batch:${roster.clubKey}:${roster.committeeKey}`;
    const batchDate = addDays(today, -150 - Math.floor(random() * 10));
    for (const member of roster.members) {
      counter += 1;
      transactions.push({
        id: demoId(`${batchKey}:${member.personKey}`),
        personKey: member.personKey,
        clubKey: roster.clubKey,
        committeeKey: roster.committeeKey,
        amount: 10,
        reason: 'حضور لقاء التعارف لأعضاء اللجنة',
        workDate: batchDate,
        recordedAfterDays: 1,
        createdByKey: supervisor,
        batchId: demoId(batchKey),
      });
    }

    // Individual transactions.
    for (const member of roster.members) {
      const count = 3 + Math.floor(random() * 6);
      for (let index = 0; index < count; index++) {
        counter += 1;
        // Removed members only have history from before their removal.
        const minDaysAgo = (member.removedDaysAgo ?? 0) + 1;
        const daysAgo = minDaysAgo + Math.floor(random() * Math.max(1, 175 - minDaysAgo));
        const isDeduction = random() < 0.15;
        const amount = isDeduction
          ? pick(random, NEGATIVE_AMOUNTS)
          : pick(random, POSITIVE_AMOUNTS);
        const reason = isDeduction
          ? pick(random, NEGATIVE_REASONS)
          : pick(random, POSITIVE_REASONS);
        const transaction: DemoTransaction = {
          id: demoId(`tx:${roster.clubKey}:${roster.committeeKey}:${member.personKey}:${index}`),
          personKey: member.personKey,
          clubKey: roster.clubKey,
          committeeKey: roster.committeeKey,
          amount,
          reason,
          workDate: addDays(today, -daysAgo),
          recordedAfterDays: Math.min(daysAgo, Math.floor(random() * 3)),
          createdByKey: recorder(member.personKey),
          batchId: null,
        };
        if (counter % 7 === 0 && amount > 0) {
          transaction.edit = {
            previousAmount: amount === 5 ? 10 : amount - 5,
            previousReason: reason,
            byKey: supervisor,
          };
        }
        if (counter % 11 === 0) {
          transaction.cancellation = {
            reason: pick(random, CANCELLATION_REASONS),
            byKey: supervisor,
          };
        }
        transactions.push(transaction);
      }
    }
  }
  return transactions;
}

/**
 * A transaction row as both the seed and the integration-test factory have already built it.
 * Dates are `Date | string` because that is what Prisma's createMany input accepts, and the seed
 * passes its rows straight through.
 */
interface BatchedRow {
  batchId?: string | null;
  clubId: string;
  committeeId: string;
  createdById: string;
  createdAt?: Date | string;
}

/** One PointBatch per shared batch id, as the demo data needs them to exist. */
export interface DemoPointBatch {
  id: string;
  clubId: string;
  committeeId: string | null;
  createdById: string;
  createdAt?: Date | string;
}

/**
 * The batches a set of transaction rows belongs to. `PointTransaction.batchId` is a composite
 * foreign key onto `PointBatch` (docs/adr/0022-bulk-points.md), so these rows have to be inserted
 * first — by the seed and by the integration-test factory alike, which is why the derivation
 * lives here rather than in either of them.
 *
 * A batch takes the committee when every transaction in it shares one, and otherwise none; who
 * recorded the earliest of them, and when. `requestHash` is left unset: a demo batch was never an
 * API request, so none of them can be replayed.
 */
export function demoPointBatches(rows: readonly BatchedRow[]): DemoPointBatch[] {
  const at = (value: Date | string) => new Date(value).getTime();
  const batches = new Map<string, DemoPointBatch>();
  for (const row of rows) {
    if (!row.batchId) continue;
    const existing = batches.get(row.batchId);
    if (!existing) {
      batches.set(row.batchId, {
        id: row.batchId,
        clubId: row.clubId,
        committeeId: row.committeeId,
        createdById: row.createdById,
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      });
      continue;
    }
    // A batch that spans committees has no single committee to name.
    if (existing.committeeId !== row.committeeId) existing.committeeId = null;
    // The earliest row decides when the batch was recorded, and by whom.
    if (row.createdAt && existing.createdAt && at(row.createdAt) < at(existing.createdAt)) {
      existing.createdAt = row.createdAt;
      existing.createdById = row.createdById;
    }
  }
  return [...batches.values()];
}
