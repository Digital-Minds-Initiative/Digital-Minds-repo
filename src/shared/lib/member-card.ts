/**
 * What a member card shows and how it is worked out, shared by the API, the browser mocks and the
 * card itself so that all three always agree (docs/adr/0031-wallet-pass.md).
 */

/** Cells on the card's stamp row. */
export const CARD_STAMPS_TOTAL = 6;

/** One stamp is earned for every this many active points. */
export const POINTS_PER_STAMP = 50;

export type CardMood = 'tech' | 'gem';

/**
 * The design system's two moods: UQU Computing leads «Gem» (teal, gold stamps), everything else
 * keeps the host's «Tech» (indigo). Chosen from the club's slug, so no new column is needed.
 */
export function cardMoodForClub(slug: string): CardMood {
  return slug === 'computing' ? 'gem' : 'tech';
}

/** Stamps earned from a points balance: one per 50 points, never below zero, at most six. */
export function stampsForPoints(points: number): number {
  return Math.min(CARD_STAMPS_TOTAL, Math.max(0, Math.floor(points / POINTS_PER_STAMP)));
}

/**
 * The short code printed on the card and encoded in its QR: the last eight characters of the
 * membership id (the first ones are a timestamp, the same for people added together). It is read
 * by whoever scans it; it grants nothing by itself.
 */
export function memberCodeForMembership(membershipId: string): string {
  return `DM-${membershipId.replaceAll('-', '').slice(-8).toUpperCase()}`;
}

/** The Umm al-Qura Hijri year and the Gregorian year a card is issued in (Asia/Riyadh). */
export function cardYears(now: Date): { hijriYear: number; gregorianYear: number } {
  const part = (calendar: string): number =>
    Number(
      new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, {
        year: 'numeric',
        timeZone: 'Asia/Riyadh',
      })
        .formatToParts(now)
        .find((p) => p.type === 'year')?.value ?? Number.NaN,
    );
  return { hijriYear: part('islamic-umalqura'), gregorianYear: part('gregory') };
}

export type CardTone = 'paper' | 'matte';

/**
 * How a card is dressed: officers and committee leads carry the dark matte badge, everyone else
 * the white one, as a conference badge changes colour for speakers and organisers.
 */
export type CardVariant = `${CardTone}-${CardMood}`;

/** The badge's colourway: its tone (the member's choice, or the role's) in the club's mood, e.g. `matte-gem`. */
export function cardVariantFor(card: { mood: CardMood; tone: CardTone }): CardVariant {
  return `${card.tone}-${card.mood}`;
}

export function cardToneFor(card: {
  clubRole: 'MEMBER' | 'CLUB_OFFICER';
  ledCommittees: readonly string[];
}): CardTone {
  return card.clubRole === 'CLUB_OFFICER' || card.ledCommittees.length > 0 ? 'matte' : 'paper';
}

const TATWEEL = 'ـ';
/** Letters a calligrapher will stretch after: they join forward and have a body that carries it. */
const STRETCHES = /[بتثنيئجحخسشصضطظعغفقم]/u;
/** The strongest places: the long bodies of seen, sad, ha, ain, and the teeth of ba and its sisters. */
const BEST_STRETCH = /[سشصضحجخعغبتثنيئ]/u;
/** After a tatweel the next letter must be able to take the join: never an alef or a hamza. */
const CANNOT_FOLLOW = /[اأإآٱء]/u;
const ARABIC_LETTER = /[ء-ي]/u;
/** One stretch never grows past this many tatweels, however short the name is. */
const MAX_PER_WORD = 4;

/**
 * Where a word can take a kashida, or -1. A stretch goes after a joining letter that is followed
 * by a letter that can take the join: never before an alef (خـالد), never inside a lam-alef, and
 * never on the article (the ال of «الحربي» stays tight). The middle of a word beats its first
 * letter, and the long-bodied letters beat the rest. A word with no good place is left as it is.
 */
function kashidaPoint(word: string): number {
  const chars = [...word];
  const from = word.startsWith('ال') ? 2 : 0;
  let best = -1;
  let bestScore = -1;
  chars.forEach((ch, i) => {
    const next = chars[i + 1];
    if (i < from || next === undefined) return;
    if (!STRETCHES.test(ch) || !ARABIC_LETTER.test(next) || CANNOT_FOLLOW.test(next)) return;
    const score = (i > 0 ? 2 : 0) + (BEST_STRETCH.test(ch) ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/**
 * The name as the badge sets it, with a kashida: the stretch (tatweel) that Arabic lettering puts
 * after a joining letter. How much depends on the name's length, so a short name gets a long
 * stretch and a long name gets none and still fits on one line. The stretch is shared between the
 * words that can take one, so a word that cannot (خالد) hands its share to the others. Only the
 * display copy is stretched; the person's name is never stored this way.
 */
export function withKashida(name: string, maxChars = 26): string {
  const words = name.split(/\s+/u).filter(Boolean);
  let left = Math.max(0, Math.min(12, Math.round((maxChars - name.length) * 1.1)));
  if (left === 0 || words.length === 0) return name;
  const points = words.map((word, index) => (index < 3 ? kashidaPoint(word) : -1));
  let takers = points.filter((point) => point !== -1).length;
  return words
    .map((word, index) => {
      const at = points[index] ?? -1;
      if (at === -1 || left === 0) return word;
      const count = Math.min(MAX_PER_WORD, Math.max(1, Math.ceil(left / takers)), left);
      left -= count;
      takers -= 1;
      const chars = [...word];
      chars.splice(at + 1, 0, TATWEEL.repeat(count));
      return chars.join('');
    })
    .join(' ');
}

/** The last six calendar months as `YYYY-MM`, oldest first, ending with the month of `today`. */
export function lastSixMonths(today: string): string[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, index) => {
    const offset = 5 - index;
    const total = year * 12 + (month - 1) - offset;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
