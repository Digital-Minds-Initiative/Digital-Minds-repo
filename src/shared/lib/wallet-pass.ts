import type { MemberCard } from '@/shared/contracts/wallet';

import { POINTS_PER_STAMP } from './member-card';

/**
 * What the wallet passes say, as plain data (docs/adr/0031-wallet-pass.md). Apple's pass is a store
 * card, the style its guidelines give membership and points cards: the points sit in the header so
 * they show when the pass is collapsed, the member's name over the strip, role and year underneath,
 * and the rarely needed details on the back. Google's pass shows the same fields. Colours and
 * pictures belong to the server (`pass/art-theme.ts`); this is only the wording.
 */

interface PassField {
  key: string;
  label: string;
  value: string | number;
  /** Left alone, Wallet aligns with the reading direction: right to left for Arabic. */
  textAlignment?: 'PKTextAlignmentNatural';
  numberStyle?: 'PKNumberStyleDecimal';
  attributedValue?: string;
}

export interface PassDefinition {
  description: string;
  organizationName: string;
  logoText: string;
  serialNumber: string;
  header: PassField[];
  primary: PassField[];
  secondary: PassField[];
  auxiliary: PassField[];
  back: PassField[];
  barcodeMessage: string;
  barcodeAltText: string;
}

/** `●●○○○○`: earned stamps filled, the rest hollow; read left to right on any device. */
export function stampRow(earned: number, total: number): string {
  const filled = Math.min(Math.max(earned, 0), total);
  return '●'.repeat(filled) + '○'.repeat(total - filled);
}

/** `{name}` placeholders in a message, filled in. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

/** The pass's wording (src/i18n/messages/ar/walletPass.json): the server and the preview share it. */
export interface PassMessages {
  description: string;
  points: string;
  role: string;
  year: string;
  committees: string;
  noCommittees: string;
  stamps: string;
  code: string;
  club: string;
  stampsHelp: string;
  stampsHelpBody: string;
  platform: string;
  about: string;
  aboutBody: string;
  roleOfficer: string;
  roleLead: string;
  stickersLabel: string;
  sticker: Record<string, string>;
}

/** What the badge calls the person: officer, lead of a committee, or their membership type. */
export function cardRoleLabel(
  card: Pick<MemberCard, 'clubRole' | 'ledCommittees' | 'role'>,
  t: Pick<PassMessages, 'roleOfficer' | 'roleLead'>,
): string {
  if (card.clubRole === 'CLUB_OFFICER') return t.roleOfficer;
  const [committee] = card.ledCommittees;
  if (committee !== undefined) return fill(t.roleLead, { committee });
  return card.role;
}

export function buildPassDefinition(
  card: MemberCard,
  appOrigin: string,
  t: PassMessages,
): PassDefinition {
  return {
    description: fill(t.description, { club: card.club.name }),
    organizationName: 'Digital Minds',
    logoText: 'Digital Minds',
    serialNumber: card.membershipId,
    header: [
      {
        key: 'points',
        label: t.points,
        value: card.points,
        numberStyle: 'PKNumberStyleDecimal',
      },
    ],
    primary: [{ key: 'member', label: card.club.name, value: card.fullName }],
    secondary: [
      { key: 'role', label: t.role, value: cardRoleLabel(card, t) },
      {
        key: 'year',
        label: t.year,
        value: `${card.hijriYear} · ${card.gregorianYear}`,
      },
    ],
    auxiliary: [
      {
        key: 'committees',
        label: t.committees,
        value: card.committees.length > 0 ? card.committees.join('، ') : t.noCommittees,
      },
      {
        key: 'stamps',
        label: t.stamps,
        value: `\u202A${stampRow(card.stampsEarned, card.stampsTotal)}\u202C`,
      },
    ],
    back: [
      { key: 'code', label: t.code, value: card.memberCode },
      { key: 'club', label: t.club, value: card.club.name },
      {
        key: 'stampsHelp',
        label: t.stampsHelp,
        value: fill(t.stampsHelpBody, { perStamp: POINTS_PER_STAMP, total: card.stampsTotal }),
      },
      ...(card.stickers.length > 0
        ? [
            {
              key: 'stickers',
              label: t.stickersLabel,
              value: card.stickers
                .map((sticker) => t.sticker[sticker.key] ?? sticker.key)
                .join('، '),
            },
          ]
        : []),
      {
        key: 'platform',
        label: t.platform,
        value: 'Digital Minds',
        attributedValue: `<a href='${appOrigin}/dashboard'>Digital Minds</a>`,
      },
      {
        key: 'about',
        label: t.about,
        value: t.aboutBody,
      },
    ],
    barcodeMessage: card.qr,
    barcodeAltText: card.memberCode,
  };
}
