import { defineRoute } from '@/server/http';
import { getPublicCommitteeView } from '@/server/modules/clubs';
import { publicCommitteeViewEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(publicCommitteeViewEndpoint, ({ params, client }) =>
  getPublicCommitteeView(params.token, client),
);
