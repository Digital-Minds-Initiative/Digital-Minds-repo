import { Amiri, Caveat, IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Newsreader } from 'next/font/google';

/**
 * The app fonts, self-hosted by next/font. Each exposes the CSS variable that a
 * `--typeface-*` primitive (tokens.css) points to — swap the font here and there.
 *
 * The design system calls for Thmanyah Sans/Serif, but Thmanyah's licence forbids
 * redistributing its files, so it is never embedded here. These are the stated
 * fallback fonts; on a machine with Thmanyah installed, components ask for it
 * first and fall through to these with no code change.
 */
export const fontSans = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans-arabic',
  display: 'swap',
});

export const fontSerif = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const fontArabicSerif = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

export const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

/** Handwriting for the short English headings on the paper notes (YOUR MOVE, DONE!…). Latin only. */
export const fontHand = Caveat({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-caveat',
  display: 'swap',
});
