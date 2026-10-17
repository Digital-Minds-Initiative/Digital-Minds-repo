import { defineRoute } from '@/server/http';
import { getPublicMemberPoints } from '@/server/modules/clubs';
import { publicMemberPointsEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(publicMemberPointsEndpoint, ({ params, query, client }) =>
  getPublicMemberPoints(params.token, params.publicId, query, client),
);
