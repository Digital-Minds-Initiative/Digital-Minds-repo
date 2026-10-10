import 'server-only';

import { z } from 'zod';

import { parseEmailDomains } from '@/lib/email-domains';

/**
 * Server environment, validated once at startup (src/instrumentation.ts imports this module).
 * Invalid or missing values stop the app with a message that names the variable.
 * Every variable is documented in .env.example — keep the two in sync.
 */

const domainSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'is not a domain');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
    ALLOWED_EMAIL_DOMAINS: z
      .string({ error: 'is required (for example "uqu.edu.sa")' })
      .transform(parseEmailDomains)
      .pipe(z.array(domainSchema).min(1, 'must list at least one domain')),
    DEV_ACTOR_SWITCHER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    NEXT_PUBLIC_API_MOCKING: z.enum(['enabled', 'disabled']).default('disabled'),
  })
  .superRefine((env, ctx) => {
    // `next build` also runs with NODE_ENV=production (on CI and on laptops with a dev .env).
    // The guard is for a running production server, where these flags would be dangerous.
    const isProductionServer =
      env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';
    if (isProductionServer && env.DEV_ACTOR_SWITCHER) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_ACTOR_SWITCHER'],
        message: 'must be false in production (it lets anyone act as any user)',
      });
    }
    if (isProductionServer && env.NEXT_PUBLIC_API_MOCKING === 'enabled') {
      ctx.addIssue({
        code: 'custom',
        path: ['NEXT_PUBLIC_API_MOCKING'],
        message: 'must be "disabled" in production',
      });
    }
  });

export type ServerEnv = z.output<typeof envSchema>;

function loadEnv(): ServerEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment variables:\n${details}\nSee .env.example for what each one means.`,
    );
  }
  return result.data;
}

export const env: ServerEnv = loadEnv();
