'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useSafeBack } from '@/client/lib/navigation-history';
import { DirectionalIcon } from '@/components/ui/directional-icon';

import { paperFocusClass } from './paper-classes';

/**
 * Returns to the page the visitor came from inside the app, or to the landing page when they
 * opened this one directly (see src/client/lib/navigation-history.ts).
 */
export function BackLink() {
  const t = useTranslations('auth');
  const goBack = useSafeBack();
  return (
    <button
      type="button"
      onClick={goBack}
      className={`-ms-2 inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-md px-2 text-sm font-medium text-on-paper-muted transition-colors hover:text-on-paper ${paperFocusClass}`}
    >
      <DirectionalIcon icon={ArrowLeft} className="size-4" />
      {t('back')}
    </button>
  );
}
