import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';

/** Digital Minds mark + name. The mark uses semantic colours, so it follows the theme. */
export function Logo({ className, showName = true }: { className?: string; showName?: boolean }) {
  const t = useTranslations('common');
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold text-fg', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-primary" />
        <path
          d="M10 9h6.5a7 7 0 0 1 0 14H10z"
          className="fill-none stroke-primary-fg"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="22.5" cy="11" r="2" className="fill-primary-fg" />
        <circle cx="22.5" cy="21" r="2" className="fill-primary-fg" />
      </svg>
      {showName ? <span className="text-base">{t('appName')}</span> : null}
    </span>
  );
}
