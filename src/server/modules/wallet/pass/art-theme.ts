import 'server-only';

import type { CardVariant } from '@/shared/lib/member-card';

/**
 * The badge's four colourways as plain hex, for the images a wallet pass is drawn from. They are
 * the same values as the `--badge-*` and club tokens in src/styles/tokens.css (a test compares
 * them), because a pass is a picture and cannot read a stylesheet.
 */
export interface ArtTheme {
  /** The pass's ground and the text on it. */
  ground: string;
  text: string;
  /** Labels: the text colour at about 70% over the ground. */
  label: string;
  /** The gradient panel: its base, its three blobs, and whether it is light (decides the grain). */
  panelBase: string;
  blobs: readonly [string, string, string];
  light: boolean;
  /** The website's pixel head. */
  mark: string;
  /** The club's logo in `public/`, as the design system supplies it for this panel. */
  logo: string;
}

export const ART_THEMES: Record<CardVariant, ArtTheme> = {
  'paper-tech': {
    ground: '#fbf9f4',
    text: '#1c1a24',
    label: '#6a6773',
    panelBase: '#e9defc',
    blobs: ['#a380ff', '#f4a664', '#57e3d8'],
    light: true,
    mark: '#4f29b7',
    logo: 'clubs/tuwaiq-club-logo.png',
  },
  'matte-tech': {
    ground: '#14121a',
    text: '#f4f1ea',
    label: '#a9a7ac',
    panelBase: '#1a1450',
    blobs: ['#a380ff', '#3b4de0', '#170f3a'],
    light: false,
    mark: '#f4f1ea',
    logo: 'clubs/tuwaiq-club-logo-reversed.png',
  },
  'matte-gem': {
    ground: '#0c272c',
    text: '#f4f1ea',
    label: '#a3b5b6',
    panelBase: '#14424b',
    blobs: ['#d2b77a', '#358b9a', '#2a636d'],
    light: false,
    mark: '#d2b77a',
    logo: 'clubs/uqu-computing-logo-white.png',
  },
  'paper-gem': {
    ground: '#fbf9f4',
    text: '#1c1a24',
    label: '#6a6773',
    panelBase: '#e3efe8',
    blobs: ['#d2b77a', '#358b9a', '#57e3d8'],
    light: true,
    mark: '#2a636d',
    logo: 'clubs/uqu-computing-diamond-era.png',
  },
};
