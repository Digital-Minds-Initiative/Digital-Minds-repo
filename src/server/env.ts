import 'server-only';

import { randomBytes } from 'node:crypto';

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
 * Used for AUTH_SECRET in development and in tests, so `pnpm dev` and the suite run without
 * setup. It is a fixed value on purpose: a restart of `pnpm dev` keeps pending sign-in codes and
 * committee view links working.
 *
 * It is never used when NODE_ENV is production. A production *server* refuses to start without a
 * secret of its own; a production *build* has none to validate against, and gets a random value
 * for the few seconds it runs, so nothing can ever be signed with a secret that is in this
 * repository under NODE_ENV=production (docs/reviews/2026-10-backend-review.md).
 */
const DEVELOPMENT_AUTH_SECRET = 'development-only-auth-secret-never-use-in-production';

/**
 * Printing sign-in codes to the log is a development convenience, so that is the default
 * everywhere except a running production server, which has to send them for real. A production
 * *build* is not a server: it sends nothing and has no key to validate, so it keeps the console.
 */
function resolveEmailTransport(
  configured: 'console' | 'resend' | undefined,
  productionServer: boolean,
): 'console' | 'resend' {
  return configured ?? (productionServer ? 'resend' : 'console');
}

/** `next build` also runs with NODE_ENV=production; only a running server is held to production rules. */
function isProductionServer(nodeEnv: string, phase: string | undefined): boolean {
  return nodeEnv === 'production' && phase !== 'phase-production-build';
}

function fallbackSecret(nodeEnv: 'development' | 'test' | 'production'): string {
  return nodeEnv === 'production' ? randomBytes(32).toString('base64') : DEVELOPMENT_AUTH_SECRET;
}

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
       * Keys the HMAC a committee view link is looked up by, and the key its stored copy is
       * encrypted with (docs/adr/0023-committee-view-link.md). It defaults to AUTH_SECRET, so
       * nothing has to be set to run the app — but giving it its own value means rotating the
       * sign-in secret does not invalidate every committee's link, and the other way round.
       */
      VIEW_LINK_SECRET: optionalString.pipe(
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
      /**
       * Which sender the app uses. `console` prints the message — the sign-in code included —
       * to the server log and keeps it in memory for tests; `resend` sends it for real.
       *
       * Unset means `console` in development and test and `resend` in production, so the app
       * runs with nothing set and a production server can never quietly not-send. Setting it
       * to `resend` locally is how you test real delivery; the key is then required, because
       * "I asked for Resend and forgot the key" must not look like "I wanted the console".
       */
      EMAIL_TRANSPORT: z.enum(['console', 'resend']).optional(),
      /** The Resend API key. Required when the transport is `resend`. */
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
      // The guards are for a running production server, where these flags would be dangerous —
      // not for `next build`, which also runs with NODE_ENV=production.
      const productionServer = isProductionServer(env.NODE_ENV, phase);
      const emailTransport = resolveEmailTransport(env.EMAIL_TRANSPORT, productionServer);
      if (productionServer) {
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
      if (emailTransport === 'resend') {
        if (!env.RESEND_API_KEY) {
          ctx.addIssue({
            code: 'custom',
            path: ['RESEND_API_KEY'],
            message:
              'is required when EMAIL_TRANSPORT is "resend": paste your Resend key, or set EMAIL_TRANSPORT=console to print the sign-in code to the terminal instead',
          });
        }
        if (!env.EMAIL_FROM) {
          ctx.addIssue({
            code: 'custom',
            path: ['EMAIL_FROM'],
            message: 'is required when EMAIL_TRANSPORT is "resend"',
          });
        }
      }
      // The console sender writes sign-in codes to the log, which on a production server is
      // both a leak and a silent failure to deliver.
      if (productionServer && emailTransport === 'console') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_TRANSPORT'],
          message:
            'must be "resend" in production (the console sender prints sign-in codes to the log)',
        });
      }
      if (productionServer && env.DEV_ACTOR_SWITCHER) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_ACTOR_SWITCHER'],
          message: 'must be false in production (it lets anyone act as any user)',
        });
      }
      if (productionServer && env.NEXT_PUBLIC_API_MOCKING === 'enabled') {
        ctx.addIssue({
          code: 'custom',
          path: ['NEXT_PUBLIC_API_MOCKING'],
          message: 'must be "disabled" in production',
        });
      }
    })
    .transform((env) => ({
      ...env,
      EMAIL_TRANSPORT: resolveEmailTransport(
        env.EMAIL_TRANSPORT,
        isProductionServer(env.NODE_ENV, phase),
      ),
      APP_ORIGIN: env.APP_ORIGIN ?? 'http://localhost:3000',
      AUTH_SECRET: env.AUTH_SECRET ?? fallbackSecret(env.NODE_ENV),
      VIEW_LINK_SECRET: env.VIEW_LINK_SECRET ?? env.AUTH_SECRET ?? fallbackSecret(env.NODE_ENV),
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
