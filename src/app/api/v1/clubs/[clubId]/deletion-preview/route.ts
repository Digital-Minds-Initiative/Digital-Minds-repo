import { defineRoute } from '@/server/http';
import { getClubDeletionPreview } from '@/server/modules/deletions';
import { getClubDeletionPreviewEndpoint } from '@/shared/contracts/deletions';

export const GET = defineRoute(getClubDeletionPreviewEndpoint, ({ actor, params }) =>
  getClubDeletionPreview(actor, params.clubId),
);
