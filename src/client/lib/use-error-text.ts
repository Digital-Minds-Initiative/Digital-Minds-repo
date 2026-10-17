'use client';

import { useTranslations } from 'next-intl';

import { ApiError } from '@/client/lib/api-client';

/**
 * The words for a failed request. A conflict carries a `reason` (`club_archived`,
 * `last_membership_type`…) that says more than the status does, so it is looked up first; anything
 * else falls back to the text for the error code.
 */
export function useErrorText(): (error: unknown) => string {
  const t = useTranslations('common');
  type ConflictKey = Parameters<typeof t>[0];
  return (error) => {
    if (!(error instanceof ApiError)) return t('errors.INTERNAL');
    const reason = error.details.reason;
    const conflictKey = `conflicts.${reason}` as ConflictKey;
    if (reason && t.has(conflictKey)) return t(conflictKey);
    return t(`errors.${error.code}`);
  };
}
