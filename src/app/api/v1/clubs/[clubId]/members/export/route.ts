import { defineRoute, withFile } from '@/server/http';
import { exportMembers } from '@/server/modules/members';
import { memberExportEndpoint } from '@/shared/contracts/members-export';

export const POST = defineRoute(memberExportEndpoint, ({ actor, params, body }) =>
  exportMembers(actor, params.clubId, body).then((file) => withFile(file.data, file)),
);
