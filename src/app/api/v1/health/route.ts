import { healthEndpoint } from '@/modules/system/contracts';
import { getHealth } from '@/modules/system/server';
import { defineRoute, withStatus } from '@/server/http';

export const GET = defineRoute(healthEndpoint, async () => {
  const health = await getHealth();
  return health.status === 'ok' ? health : withStatus(503, health);
});
