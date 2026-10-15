import { useId } from 'react';

import { cn } from '@/client/lib/utils';

/**
 * A thin repeating wave in lilac that separates the page's content from its footer. Horizontal
 * only; the wave tiles to any width. Colour follows `text-*`.
 */
export function WaveDivider({ className }: { className?: string }) {
  const id = `wave-${useId().replace(/:/g, '')}`;
  return (
    <svg aria-hidden className={cn('block h-3.5 w-full text-tuwaiq-lilac', className)}>
      <defs>
        <pattern id={id} width="28" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 7 Q7 0 14 7 T28 7" fill="none" stroke="currentColor" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#${id})`} />
    </svg>
  );
}
