'use client';

import { useTranslations } from 'next-intl';

import type { MemberCard } from '@/shared/contracts/wallet';

import { MemberBadge } from './member-badge';

const SAMPLE_CLUBS = {
  tuwaiq: {
    id: '01900000-0000-7000-8000-0000000000a1',
    name: 'نادي طويق',
    slug: 'tuwaiq',
    mood: 'tech',
  },
  computing: {
    id: '01900000-0000-7000-8000-0000000000a2',
    name: 'نادي الحوسبة',
    slug: 'computing',
    mood: 'gem',
  },
} as const;

type Sample = { key: string; club: keyof typeof SAMPLE_CLUBS; officer: boolean };

const SAMPLES: readonly Sample[] = [
  { key: 'paper-tech', club: 'tuwaiq', officer: false },
  { key: 'matte-tech', club: 'tuwaiq', officer: true },
  { key: 'paper-gem', club: 'computing', officer: false },
  { key: 'matte-gem', club: 'computing', officer: true },
];

/** A made-up card: nobody's name, points or link, and no wallet button. */
function sampleCard(sample: Sample, index: number): MemberCard {
  const club = SAMPLE_CLUBS[sample.club];
  const code = `DM-0000000${index + 1}`;
  return {
    membershipId: `01900000-0000-7000-8000-00000000b00${index + 1}`,
    club: { id: club.id, name: club.name, slug: club.slug },
    mood: club.mood,
    memberCode: code,
    fullName: sample.officer ? 'سارة عبدالله القرشي' : 'نورة خالد الحربي',
    role: sample.officer ? 'مسؤول النادي' : 'عضو فعال',
    clubRole: sample.officer ? 'CLUB_OFFICER' : 'MEMBER',
    tone: sample.officer ? 'matte' : 'paper',
    tonePreference: null,
    stickers: [],
    share: { enabled: false, showPoints: false, showActivity: false, url: null },
    qr: code,
    committees: ['لجنة المحتوى', 'لجنة التطوير'],
    ledCommittees: [],
    hijriYear: 1448,
    gregorianYear: 2026,
    points: sample.officer ? 320 : 107,
    stampsEarned: sample.officer ? 6 : 2,
    stampsTotal: 6,
    wallet: { apple: false, google: false },
  };
}

/**
 * «معاينة البطاقات»: the four ways a badge is dressed (member or officer, in each club's colours),
 * drawn from made-up data. A full admin who holds no membership has no card of their own, and a
 * member's real card is theirs alone, so this is how an admin sees and tests every look.
 */
export function CardPreviews() {
  const t = useTranslations('wallet.preview');
  return (
    <section aria-labelledby="card-previews-title" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="card-previews-title" className="text-base font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-fg-muted">{t('subtitle')}</p>
      </div>
      <ul className="m-0 grid list-none gap-10 p-0 sm:grid-cols-2">
        {SAMPLES.map((sample, index) => (
          <li key={sample.key} className="grid gap-2">
            <p className="text-sm font-medium text-fg-muted">
              {t(`variants.${sample.key}` as 'variants.paper-tech')} · {t('sample')}
            </p>
            <div className="w-full max-w-[22.4rem]">
              <MemberBadge card={sampleCard(sample, index)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
