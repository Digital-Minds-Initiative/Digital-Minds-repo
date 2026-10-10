import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '../env';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/digital_minds',
  ALLOWED_EMAIL_DOMAINS: 'uqu.edu.sa',
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
    expect(parseServerEnv({ ...valid, NODE_ENV: 'production' })).toMatchObject({
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
