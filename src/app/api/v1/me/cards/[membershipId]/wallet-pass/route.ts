import { defineRoute, withFile } from '@/server/http';
import { getMyWalletPass } from '@/server/modules/wallet';
import { WALLET_PASS_CONTENT_TYPE, walletPassEndpoint } from '@/shared/contracts/wallet';

export const GET = defineRoute(walletPassEndpoint, async ({ actor, params }) => {
  const { bytes, filename } = await getMyWalletPass(actor, params.membershipId);
  return withFile(new Uint8Array(bytes), { contentType: WALLET_PASS_CONTENT_TYPE, filename });
});
