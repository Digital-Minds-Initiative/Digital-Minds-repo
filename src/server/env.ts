import 'server-only';

import { z } from 'zod';

import { parseEmailDomains } from '@/shared/lib/email-domains';

/**
 * Server environment, validated once at startup (src/instrumentation.ts imports this module).
 * Invalid or missing values stop the app with a message that names the variable.
 * Every variable is documented in .env.example — keep the two in sync.
 */

const domainSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'is not a domain');

/** An unset or blank variable (`RESEND_API_KEY=` in .env) counts as missing. */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

/**
 * Used for AUTH_SECRET outside a production server, so `pnpm dev` and the tests run without
 * setup. A production server refuses to start without its own secret.
 */
const DEVELOPMENT_AUTH_SECRET = 'development-only-auth-secret-never-use-in-production';

/** `phase` is NEXT_PHASE: `next build` sets it, a running server does not. */
const envSchema = (phase: string | undefined) =>
  z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
      ALLOWED_EMAIL_DOMAINS: z
        .string({ error: 'is required (for example "uqu.edu.sa")' })
        .transform(parseEmailDomains)
        .pipe(z.array(domainSchema).min(1, 'must list at least one domain')),
      /** Where users open the app. Non-GET API requests must come from this origin (CSRF). */
      APP_ORIGIN: optionalString.pipe(
        z
          .url({ protocol: /^https?$/, error: 'must be an http(s):// URL' })
          .transform((value) => new URL(value).origin)
          .optional(),
      ),
      /** Keys the HMACs of sign-in codes and rate-limit keys. */
      AUTH_SECRET: optionalString.pipe(
        z.string().min(32, 'must be at least 32 characters').optional(),
      ),
      /**
       * The request header that holds the client IP, set by the reverse proxy in front of the app
       * (for example `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`), or `none`. Any other
       * header can be forged by the client, so only name one your proxy overwrites or appends to.
       * Unset means "none" outside production; a production server requires it explicitly.
       */
      CLIENT_IP_HEADER: optionalString.pipe(
        z
          .string()
          .toLowerCase()
          .regex(/^[a-z0-9-]+$/, 'must be a header name or "none"')
          .optional(),
      ),
      /** Sends email through Resend when set; otherwise the dev sender prints emails to the console. */
      RESEND_API_KEY: optionalString,
      /** For example `Digital Minds <no-reply@auth.digitalmindsint.org>`. */
      EMAIL_FROM: optionalString,
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
        env.NODE_ENV === 'production' && phase !== 'phase-production-build';
      if (isProductionServer) {
        for (const name of ['APP_ORIGIN', 'AUTH_SECRET', 'RESEND_API_KEY'] as const) {
          if (!env[name]) {
            ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
          }
        }
        // So the per-IP sign-in limits are a deliberate choice at deployment, never forgotten.
        if (!env.CLIENT_IP_HEADER) {
          ctx.addIssue({
            code: 'custom',
            path: ['CLIENT_IP_HEADER'],
            message:
              'is required in production: the header your proxy sets with the client IP, or "none" (turns the per-IP limits off)',
          });
        }
        if (env.AUTH_SECRET === DEVELOPMENT_AUTH_SECRET) {
          ctx.addIssue({
            code: 'custom',
            path: ['AUTH_SECRET'],
            message: 'must be your own secret in production',
          });
        }
      }
      if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_FROM'],
          message: 'is required when RESEND_API_KEY is set',
        });
      }
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
    })
    .transform((env) => ({
      ...env,
      APP_ORIGIN: env.APP_ORIGIN ?? 'http://localhost:3000',
      AUTH_SECRET: env.AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
      CLIENT_IP_HEADER:
        env.CLIENT_IP_HEADER === undefined || env.CLIENT_IP_HEADER === 'none'
          ? null
          : env.CLIENT_IP_HEADER,
    }));

export type ServerEnv = z.output<ReturnType<typeof envSchema>>;

/** Validates environment variables; throws one error that names every invalid variable. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = envSchema(source.NEXT_PHASE).safeParse(source);
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

export const env: ServerEnv = parseServerEnv(process.env);
