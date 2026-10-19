import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '../env';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/digital_minds',
  ALLOWED_EMAIL_DOMAINS: 'uqu.edu.sa',
};

/** Everything a production server needs. */
const production = {
  ...valid,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://app.example.org',
  AUTH_SECRET: 'a'.repeat(32),
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Digital Minds <no-reply@auth.example.org>',
  CLIENT_IP_HEADER: 'x-forwarded-for',
};

describe('server environment', () => {
  it('refuses to start a production server with the dev actor switcher or API mocking', () => {
    expect(() =>
      parseServerEnv({ ...valid, NODE_ENV: 'production', DEV_ACTOR_SWITCHER: 'true' }),
    ).toThrow(/DEV_ACTOR_SWITCHER must be false in production/);
    expect(() =>
      parseServerEnv({ ...valid, NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'enabled' }),
    ).toThrow(/NEXT_PUBLIC_API_MOCKING must be "disabled" in production/);
  });

  it('allows both in development and while `next build` runs', () => {
    expect(
      parseServerEnv({ ...valid, NODE_ENV: 'development', DEV_ACTOR_SWITCHER: 'true' }),
    ).toMatchObject({ DEV_ACTOR_SWITCHER: true });
    expect(
      parseServerEnv({
        ...valid,
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
        DEV_ACTOR_SWITCHER: 'true',
        NEXT_PUBLIC_API_MOCKING: 'enabled',
      }),
    ).toMatchObject({ DEV_ACTOR_SWITCHER: true });
  });

  it('keeps the switcher off unless it is exactly "true"', () => {
    expect(parseServerEnv(production)).toMatchObject({
      DEV_ACTOR_SWITCHER: false,
      NEXT_PUBLIC_API_MOCKING: 'disabled',
    });
    expect(() => parseServerEnv({ ...valid, DEV_ACTOR_SWITCHER: 'yes' })).toThrow(
      /DEV_ACTOR_SWITCHER/,
    );
  });

  it('names every invalid variable', () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: 'mysql://localhost/db', ALLOWED_EMAIL_DOMAINS: '' }),
    ).toThrow(/DATABASE_URL[\s\S]*ALLOWED_EMAIL_DOMAINS/);
  });
});

describe('auth and email settings', () => {
  it('uses local defaults outside production', () => {
    const env = parseServerEnv({ ...valid, NODE_ENV: 'development', RESEND_API_KEY: '' });
    expect(env).toMatchObject({ APP_ORIGIN: 'http://localhost:3000', CLIENT_IP_HEADER: null });
    expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it('requires the origin, secret and email key on a production server', () => {
    expect(() => parseServerEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /APP_ORIGIN is required[\s\S]*AUTH_SECRET is required[\s\S]*RESEND_API_KEY is required[\s\S]*CLIENT_IP_HEADER is required/,
    );
    expect(parseServerEnv(production)).toMatchObject({ APP_ORIGIN: 'https://app.example.org' });
  });

  it('refuses the development secret and short secrets in production', () => {
    const devSecret = parseServerEnv({ ...valid }).AUTH_SECRET;
    expect(() => parseServerEnv({ ...production, AUTH_SECRET: devSecret })).toThrow(
      /AUTH_SECRET must be your own secret/,
    );
    expect(() => parseServerEnv({ ...production, AUTH_SECRET: 'short' })).toThrow(
      /AUTH_SECRET must be at least 32/,
    );
  });

  it('normalises APP_ORIGIN to an origin', () => {
    expect(parseServerEnv({ ...valid, APP_ORIGIN: 'https://App.example.org/path/' })).toMatchObject(
      { APP_ORIGIN: 'https://app.example.org' },
    );
    expect(() => parseServerEnv({ ...valid, APP_ORIGIN: 'ftp://example.org' })).toThrow(
      /APP_ORIGIN/,
    );
  });

  it('makes a production server name the client IP header, or say "none", explicitly', () => {
    const { CLIENT_IP_HEADER: _, ...unset } = production;
    for (const missing of [unset, { ...production, CLIENT_IP_HEADER: '' }]) {
      expect(() => parseServerEnv(missing)).toThrow(/CLIENT_IP_HEADER is required in production/);
    }
    expect(parseServerEnv({ ...production, CLIENT_IP_HEADER: 'none' })).toMatchObject({
      CLIENT_IP_HEADER: null,
    });
    expect(parseServerEnv(production)).toMatchObject({ CLIENT_IP_HEADER: 'x-forwarded-for' });
    // `next build` is not a running server: unset still means none there.
    expect(parseServerEnv({ ...unset, NEXT_PHASE: 'phase-production-build' })).toMatchObject({
      CLIENT_IP_HEADER: null,
    });
  });

  it('trusts no IP header unless one is named', () => {
    expect(parseServerEnv({ ...valid, CLIENT_IP_HEADER: 'X-Forwarded-For' })).toMatchObject({
      CLIENT_IP_HEADER: 'x-forwarded-for',
    });
    expect(parseServerEnv({ ...valid, CLIENT_IP_HEADER: 'none' })).toMatchObject({
      CLIENT_IP_HEADER: null,
    });
    expect(() => parseServerEnv({ ...valid, CLIENT_IP_HEADER: 'x forwarded' })).toThrow(
      /CLIENT_IP_HEADER/,
    );
  });

  it('needs a sender address with a Resend key', () => {
    expect(() => parseServerEnv({ ...valid, RESEND_API_KEY: 're_test' })).toThrow(
      /EMAIL_FROM is required when RESEND_API_KEY is set/,
    );
  });
  /*
   * The development secret is a fixed string in this repository, so nothing may ever sign with it
   * under NODE_ENV=production — not even during a build, which needs no real secret
   * (docs/reviews/2026-10-backend-review.md).
   */
  describe('secrets', () => {
    const DEVELOPMENT_SECRET = 'development-only-auth-secret-never-use-in-production';

    it('uses the fixed development secret in development and in tests', () => {
      for (const NODE_ENV of ['development', 'test']) {
        expect(parseServerEnv({ ...valid, NODE_ENV })).toMatchObject({
          AUTH_SECRET: DEVELOPMENT_SECRET,
        });
      }
    });

    it('never uses it under NODE_ENV=production', () => {
      // A running production server is refused outright.
      expect(() => parseServerEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
        /AUTH_SECRET is required in production/,
      );
      // A build has nothing to validate against, and gets a value nobody else knows.
      const build = parseServerEnv({
        ...valid,
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
      });
      expect(build.AUTH_SECRET).not.toBe(DEVELOPMENT_SECRET);
      expect(build.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('refuses the development secret on a production server', () => {
      expect(() => parseServerEnv({ ...production, AUTH_SECRET: DEVELOPMENT_SECRET })).toThrow(
        /AUTH_SECRET must be your own secret in production/,
      );
    });

    it('gives the view links AUTH_SECRET until they are given their own', () => {
      expect(parseServerEnv(production)).toMatchObject({
        AUTH_SECRET: 'a'.repeat(32),
        VIEW_LINK_SECRET: 'a'.repeat(32),
      });
      expect(parseServerEnv({ ...production, VIEW_LINK_SECRET: 'b'.repeat(40) })).toMatchObject({
        AUTH_SECRET: 'a'.repeat(32),
        VIEW_LINK_SECRET: 'b'.repeat(40),
      });
    });

    it('holds VIEW_LINK_SECRET to the same length as AUTH_SECRET', () => {
      expect(() => parseServerEnv({ ...production, VIEW_LINK_SECRET: 'short' })).toThrow(
        /VIEW_LINK_SECRET must be at least 32 characters/,
      );
    });
  });
});
