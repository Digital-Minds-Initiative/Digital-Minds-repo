import { defineRoute, withFile } from '@/server/http';
import { getCommitteeMemberImportTemplate } from '@/server/modules/members';
import { committeeMemberImportTemplateEndpoint } from '@/shared/contracts/members-import';

export const GET = defineRoute(committeeMemberImportTemplateEndpoint, ({ actor, params }) =>
  getCommitteeMemberImportTemplate(actor, params.committeeId).then((csv) =>
    withFile(csv, { contentType: 'text/csv; charset=utf-8', filename: 'members-import.csv' }),
  ),
);
