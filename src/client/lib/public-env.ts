import { z } from 'zod';

/**
 * Browser-visible settings (NEXT_PUBLIC_*). Next.js inlines them at build time, so each one must be
 * read with its literal name. Validated on load: an invalid value stops the app immediately.
 * Server-only settings live in src/server/env.ts.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_MOCKING: z.enum(['enabled', 'disabled']).default('disabled'),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_MOCKING: process.env.NEXT_PUBLIC_API_MOCKING,
});
