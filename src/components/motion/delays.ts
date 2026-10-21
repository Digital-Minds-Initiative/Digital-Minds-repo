/**
 * When each part of the landing page moves, in milliseconds. The whole first-load sequence is read
 * from here, so it can be retimed in one place: the header drops in, its line draws, then the
 * hero's text, its cards and its stickers follow, top to bottom.
 */
export const DELAYS = {
  /** The header itself drops in at once; its logo and then its buttons follow. */
  logo: 80,
  actions: 160,
  /** The pixel line under the header draws from the right edge. */
  headerLine: 150,
  /** The hero's text, one line after another. */
  heroText: 250,
  heroTextStep: 120,
  heroCards: 450,
  heroCardsStep: 100,
  stickers: 800,
  stickersStep: 120,
  /** Inside a section: the next element comes in this long after the one before it. */
  sectionStep: 100,
  /** A pixel divider is drawn this much before the content under it. */
  dividerLead: 100,
} as const;
