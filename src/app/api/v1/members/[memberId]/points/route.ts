import { defineRoute } from '@/server/http';
import { getMemberPoints } from '@/server/modules/points';
import { getMemberPointsEndpoint } from '@/shared/contracts/points';

export const GET = defineRoute(getMemberPointsEndpoint, ({ actor, params, query }) =>
  getMemberPoints(actor, params.memberId, query),
);
