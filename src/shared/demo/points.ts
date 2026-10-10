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
