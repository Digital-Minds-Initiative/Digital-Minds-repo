import { defineRoute } from '@/server/http';
import { getMyAlbum } from '@/server/modules/wallet';
import { albumEndpoint } from '@/shared/contracts/stickers';

export const GET = defineRoute(albumEndpoint, ({ actor, params }) =>
  getMyAlbum(actor, params.membershipId),
);
