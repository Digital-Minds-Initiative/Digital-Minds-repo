import { defineRoute, withFile } from '@/server/http';
import { getMemberImportTemplate } from '@/server/modules/members';
import { memberImportTemplateEndpoint } from '@/shared/contracts/members-import';

export const GET = defineRoute(memberImportTemplateEndpoint, ({ actor, params }) =>
  getMemberImportTemplate(actor, params.clubId).then((csv) =>
    withFile(csv, { contentType: 'text/csv; charset=utf-8', filename: 'members-import.csv' }),
  ),
);
