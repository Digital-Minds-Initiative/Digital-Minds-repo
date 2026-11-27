import { defineRoute } from '@/server/http';
import { getStickerStats } from '@/server/modules/cards';
import { stickerStatsEndpoint } from '@/shared/contracts/stickers';

export const GET = defineRoute(stickerStatsEndpoint, ({ actor, params }) =>
  getStickerStats(actor, params.stickerId),
);
