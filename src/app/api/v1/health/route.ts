import { defineRoute, withStatus } from '@/server/http';
import { getHealth } from '@/server/modules/system';
import { healthEndpoint } from '@/shared/contracts/system';

export const GET = defineRoute(healthEndpoint, async () => {
  const health = await getHealth();
  return health.status === 'ok' ? health : withStatus(503, health);
});
