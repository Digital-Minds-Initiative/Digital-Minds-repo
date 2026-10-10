import { z } from 'zod';

import { defineEndpoint, isoDateTimeSchema } from '@/lib/contracts';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
  time: isoDateTimeSchema,
});
export type Health = z.infer<typeof healthSchema>;

/** Liveness/readiness probe. 200 when healthy, 503 when a dependency is down. */
export const healthEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health',
  access: 'public',
  response: healthSchema,
});
