'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface PagerProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label: string;
}

/** Previous / next with "page of pages" between them; nothing when there is one page. */
export function Pager({ page, pageCount, onChange, label }: PagerProps) {
  const t = useTranslations('points.screen.pagination');
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t('previous')}
      </Button>
      <span className="text-fg-muted">{t('page', { page, pages: pageCount })}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {t('next')}
      </Button>
    </nav>
  );
}
