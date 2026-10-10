import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('common');
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <EmptyState
        className="w-full"
        icon={SearchX}
        title={t('notFound.title')}
        description={t('notFound.body')}
        action={
          <Button asChild variant="outline">
            <Link href="/">{t('actions.goHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}
