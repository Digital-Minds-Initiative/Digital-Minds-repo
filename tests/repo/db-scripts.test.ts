import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * The package scripts that can drop or rewrite data reach Prisma only through
 * scripts/db-guarded.ts, which refuses any database that is neither local nor commented
 * `app.environment=dev`. A script calling `prisma` directly would skip that check.
 */

const { scripts } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };

describe('destructive database scripts', () => {
  it.each(['db:migrate', 'db:reset', 'db:studio'])('%s runs through the guard first', (name) => {
    expect(scripts[name]).toMatch(/^tsx scripts\/db-guarded\.ts /);
  });

  it('no other script runs migrate dev, migrate reset or studio directly', () => {
    for (const [name, command] of Object.entries(scripts)) {
      const unguarded = command.replace(/tsx scripts\/db-guarded\.ts [^&]*/g, '');
      expect(unguarded, name).not.toMatch(/prisma (migrate (dev|reset)|studio)/);
    }
  });
});
