import { describe, expect, it } from 'vitest';

import { parseEnvironmentComment } from '../../scripts/lib/database-target';

describe('parseEnvironmentComment', () => {
  it('reads the environment the runbook writes', () => {
    expect(parseEnvironmentComment('app.environment=dev')).toBe('dev');
    expect(parseEnvironmentComment('app.environment=production')).toBe('production');
    expect(parseEnvironmentComment('  app.environment=dev\n')).toBe('dev');
  });

  it('names no environment for anything else, so the destructive scripts refuse', () => {
    for (const comment of [
      null,
      undefined,
      '',
      'dev',
      'app.environment = dev',
      "app.environment='dev'",
      'app.environment=dev; keep',
      'App.Environment=dev',
      'app.environment=',
    ]) {
      expect(parseEnvironmentComment(comment)).toBeNull();
    }
  });
});
