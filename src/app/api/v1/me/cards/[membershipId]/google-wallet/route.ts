import { defineRoute } from '@/server/http';
import { getMyGoogleWalletUrl } from '@/server/modules/wallet';
import { googleWalletEndpoint } from '@/shared/contracts/wallet';

export const GET = defineRoute(googleWalletEndpoint, ({ actor, params }) =>
  getMyGoogleWalletUrl(actor, params.membershipId),
);
