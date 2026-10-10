'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

/** Last-resort boundary for unexpected render errors. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-lg items-center px-4">
      <EmptyState
        className="w-full"
        icon={TriangleAlert}
        title={t('errors.INTERNAL')}
        action={
          <Button variant="outline" onClick={reset}>
            <RotateCw aria-hidden />
            {t('actions.retry')}
          </Button>
        }
      />
    </div>
  );
}
