import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';

/** The pixel head as a mask: a coloured box is cut to its shape, so any background colour paints it. */
export const MARK_MASK_STYLE = {
  aspectRatio: '485 / 560',
  WebkitMaskImage: 'url(/brand/mark-mask.png)',
  maskImage: 'url(/brand/mark-mask.png)',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
} as const;

/**
 * Digital Minds mark + name. The mark is the pixel-mosaic head-in-profile, masked
 * so it's always rendered in `brand` and follows the theme (light → indigo, dark →
 * lilac) with no separate dark-mode asset.
 */
export function Logo({
  className,
  showName = true,
  nameClassName,
  tone = 'default',
}: {
  className?: string;
  showName?: boolean;
  /** Extra classes for the name, for example to hide it on narrow screens. */
  nameClassName?: string;
  tone?: 'default' | 'on-deep';
}) {
  const t = useTranslations('common');
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold text-fg', className)}>
      <span
        aria-hidden
        className={cn('block h-8 w-auto shrink-0', tone === 'on-deep' ? 'bg-on-deep' : 'bg-brand')}
        style={MARK_MASK_STYLE}
      />
      {showName ? (
        <span className={cn('text-sm whitespace-nowrap sm:text-base', nameClassName)}>
          {t('appName')}
        </span>
      ) : null}
    </span>
  );
}
