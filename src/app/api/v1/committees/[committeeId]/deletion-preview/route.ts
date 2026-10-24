import { defineRoute } from '@/server/http';
import { getCommitteeDeletionPreview } from '@/server/modules/deletions';
import { getCommitteeDeletionPreviewEndpoint } from '@/shared/contracts/deletions';

export const GET = defineRoute(getCommitteeDeletionPreviewEndpoint, ({ actor, params }) =>
  getCommitteeDeletionPreview(actor, params.committeeId),
);
