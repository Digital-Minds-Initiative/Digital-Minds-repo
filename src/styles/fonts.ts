import { IBM_Plex_Sans_Arabic } from 'next/font/google';

/**
 * The app font, self-hosted by next/font. It exposes the CSS variable that the
 * `--typeface-arabic-sans` primitive (tokens.css) points to — swap the font here and there.
 */
export const fontSans = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans-arabic',
  display: 'swap',
});
