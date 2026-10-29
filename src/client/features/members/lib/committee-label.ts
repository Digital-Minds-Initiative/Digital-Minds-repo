'use client';

import { useTranslations } from 'next-intl';

import type { AdmittingCommittee } from './access';

/**
 * How a committee a lead adds people to is named in a picker: by itself, and with its club too
 * when the lead's committees are in more than one club, where two could share a name.
 */
export function useCommitteeLabel(
  committees: readonly AdmittingCommittee[],
): (committee: AdmittingCommittee) => string {
  const t = useTranslations('members.form.fields');
  const severalClubs = new Set(committees.map((committee) => committee.clubName)).size > 1;
  return (committee) =>
    severalClubs
      ? t('committeeInClub', { committee: committee.name, club: committee.clubName })
      : committee.name;
}
