import { defineRoute, withFile } from '@/server/http';
import { getWalletArt } from '@/server/modules/wallet';
import { walletArtEndpoint } from '@/shared/contracts/wallet';

export const GET = defineRoute(walletArtEndpoint, async ({ params }) =>
  withFile(new Uint8Array(getWalletArt(params.name)), {
    contentType: 'image/png',
    filename: `${params.name}.png`,
  }),
);
