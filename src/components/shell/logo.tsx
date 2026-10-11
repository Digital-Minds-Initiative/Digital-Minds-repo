import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';

/**
 * Digital Minds mark + name. The mark is the pixel-mosaic head-in-profile, masked
 * so it's always rendered in `brand` and follows the theme (light → indigo, dark →
 * lilac) with no separate dark-mode asset.
 */
export function Logo({
  className,
  showName = true,
  tone = 'default',
}: {
  className?: string;
  showName?: boolean;
  tone?: 'default' | 'on-deep';
}) {
  const t = useTranslations('common');
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold text-fg', className)}>
      <span
        aria-hidden
        className={cn('block h-8 w-auto shrink-0', tone === 'on-deep' ? 'bg-on-deep' : 'bg-brand')}
        style={{
          aspectRatio: '485 / 560',
          WebkitMaskImage: 'url(/brand/mark-mask.png)',
          maskImage: 'url(/brand/mark-mask.png)',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
      {showName ? <span className="text-base">{t('appName')}</span> : null}
    </span>
  );
}
