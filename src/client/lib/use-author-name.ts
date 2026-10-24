'use client';

import { useTranslations } from 'next-intl';

/**
 * The name to show for whoever wrote a history row — recorded or cancelled points, edited them,
 * granted a role. The API sends null once a full admin deleted that person's data
 * (docs/adr/0026-person-deletion.md), and the row then says «عضو محذوف».
 */
export function useAuthorName(): (fullName: string | null) => string {
  const t = useTranslations('common');
  return (fullName) => fullName ?? t('deletedPerson');
}
