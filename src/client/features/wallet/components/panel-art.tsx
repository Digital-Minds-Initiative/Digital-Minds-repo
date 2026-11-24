import { useId, type CSSProperties } from 'react';

import { cn } from '@/client/lib/utils';

import type { BadgeTheme } from '../lib/badge-theme';

/** Grain: monochrome film noise blended over what is under it. */
function Grain({
  blend,
  opacity,
  frequency,
}: {
  blend: 'overlay' | 'soft-light';
  opacity: number;
  frequency: number;
}) {
  const id = useId();
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
      style={{ mixBlendMode: blend, opacity }}
    >
      <filter id={id}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency={frequency}
          numOctaves={3}
          stitchTiles="stitch"
        />
        <feColorMatrix
          type="matrix"
          values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"
        />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

function Blob({
  color,
  style,
  drift,
}: {
  color: string;
  style: CSSProperties;
  drift: 'a' | 'b' | null;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'absolute rounded-full',
        drift === 'a' && 'motion-safe:animate-[badge-drift-a_16s_ease-in-out_infinite]',
        drift === 'b' && 'motion-safe:animate-[badge-drift-b_20s_ease-in-out_infinite]',
      )}
      style={{
        background: `radial-gradient(closest-side, ${color}, color-mix(in oklab, ${color} 55%, transparent) 55%, transparent)`,
        filter: 'blur(16px)',
        ...style,
      }}
    />
  );
}

/**
 * The gradient panel's picture: three soft blobs of light that drift, film grain over them, and the
 * thin rounded outlines that cross it. It fills its parent, which holds the panel's base colour.
 * The badge's front and the public page behind a QR share it, so they are the same panel.
 */
export function PanelArt({ theme }: { theme: BadgeTheme }) {
  return (
    <>
      <Blob
        color={theme.panelBlobs[0]}
        drift="a"
        style={{ width: 330, height: 250, insetInlineEnd: -60, top: -110 }}
      />
      <Blob
        color={theme.panelBlobs[1]}
        drift="b"
        style={{ width: 340, height: 250, insetInlineStart: -120, bottom: -140 }}
      />
      <Blob
        color={theme.panelBlobs[2]}
        drift={null}
        style={{ width: 200, height: 120, insetInlineStart: 40, top: 70 }}
      />
      <Grain blend="overlay" opacity={theme.panelIsLight ? 0.6 : 0.55} frequency={0.9} />
      <Grain blend="soft-light" opacity={0.15} frequency={0.5} />
      <svg
        aria-hidden
        className="absolute inset-0 size-full"
        fill="none"
        stroke={theme.panelOutline}
        strokeWidth={1.2}
        viewBox="0 0 326 214"
        preserveAspectRatio="xMidYMid slice"
      >
        <rect x="196" y="-34" width="110" height="110" rx="22" transform="rotate(32 251 21)" />
        <rect x="228" y="62" width="92" height="92" rx="20" transform="rotate(32 274 108)" />
        <rect x="-30" y="118" width="100" height="100" rx="22" transform="rotate(32 20 168)" />
      </svg>
    </>
  );
}
