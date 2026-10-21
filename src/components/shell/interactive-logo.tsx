'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { cn } from '@/client/lib/utils';
import { Link } from '@/i18n/navigation';

import { MARK_MASK_STYLE } from './logo';

/**
 * The colours the mark cycles through, each with a name colour that goes with it: the brand
 * purple, lavender, cyan and peach of the landing page's decorations. They are the project's
 * semantic tokens, so every step also has a dark-theme value.
 */
const TONES = [
  { mark: 'bg-brand', name: 'text-fg' },
  { mark: 'bg-tuwaiq-lilac', name: 'text-tuwaiq-indigo dark:text-tuwaiq-lilac' },
  { mark: 'bg-teal', name: 'text-teal' },
  { mark: 'bg-orange', name: 'text-orange' },
] as const;

/**
 * The header logo. The pixel head is a button: each press moves to the next colour of the palette
 * and the name follows it. The name stays the link to the home page. Colour changes in 200 ms with
 * a short stepped hop (none under reduced motion).
 */
export function InteractiveLogo({ nameClassName }: { nameClassName?: string }) {
  const t = useTranslations('common');
  const tShell = useTranslations('shell.public');
  const [step, setStep] = useState(0);
  const tone = TONES[step % TONES.length] ?? TONES[0];

  return (
    <span className="inline-flex items-center gap-3 font-bold">
      <button
        type="button"
        aria-label={tShell('logoColor')}
        onClick={() => setStep((current) => (current + 1) % TONES.length)}
        className="group -m-1 flex cursor-pointer items-center rounded-md p-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-safe:animate-[logo-blink_6s_steps(1)_infinite]"
      >
        {/* Keyed by the step so the hop starts again on every press. */}
        <span
          key={step}
          aria-hidden
          className={cn(
            'block h-10 w-auto shrink-0 transition-[background-color,scale] duration-200 ease-out',
            'group-hover:scale-105 group-active:scale-95 motion-safe:animate-[logo-hop_0.3s_steps(4)]',
            tone.mark,
          )}
          style={MARK_MASK_STYLE}
        />
      </button>
      <Link
        href="/"
        aria-label={t('appName')}
        className={cn(
          'rounded-md text-base whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid sm:text-lg',
          tone.name,
          nameClassName,
        )}
      >
        {t('appName')}
      </Link>
    </span>
  );
}
