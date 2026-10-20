import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, STRICT_TRANSPORT_SECURITY } from '../security-headers';

const policy = (development = false) =>
  buildContentSecurityPolicy({ nonce: 'test-nonce', development });

/** The directives of a policy, by name. */
const directives = (value: string) =>
  new Map(
    value.split('; ').map((directive) => {
      const [name, ...rest] = directive.split(' ');
      return [name ?? '', rest.join(' ')];
    }),
  );

describe('the Content-Security-Policy', () => {
  it('trusts scripts by nonce, and whatever they load, and nothing else', () => {
    const scripts = directives(policy()).get('script-src');
    expect(scripts).toBe(`'self' 'nonce-test-nonce' 'strict-dynamic'`);
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('allows no frame, no object, no base and no other origin', () => {
    const parsed = directives(policy());
    expect(parsed.get('default-src')).toBe(`'self'`);
    expect(parsed.get('frame-ancestors')).toBe(`'none'`);
    expect(parsed.get('frame-src')).toBe(`'none'`);
    expect(parsed.get('object-src')).toBe(`'none'`);
    expect(parsed.get('base-uri')).toBe(`'none'`);
    expect(parsed.get('connect-src')).toBe(`'self'`);
  });

  /*
   * Deliberate: the design system sets `style` attributes, and a nonce in `style-src` would turn
   * `'unsafe-inline'` off for them. Pinned here so it stays a decision rather than a drift.
   */
  it('allows inline styles, and says so without a nonce', () => {
    const styles = directives(policy()).get('style-src');
    expect(styles).toBe(`'self' 'unsafe-inline'`);
    expect(styles).not.toContain('nonce');
  });

  it('upgrades insecure requests in production only', () => {
    expect(policy()).toContain('upgrade-insecure-requests');
    expect(policy(true)).not.toContain('upgrade-insecure-requests');
  });

  it('loosens exactly two things in development', () => {
    const parsed = directives(policy(true));
    // React rebuilds server stacks in the browser with eval, and the dev server pushes over ws.
    expect(parsed.get('script-src')).toContain(`'unsafe-eval'`);
    expect(parsed.get('connect-src')).toBe(`'self' ws:`);
  });

  it('carries a different nonce every time it is built', () => {
    const first = buildContentSecurityPolicy({ nonce: 'one', development: false });
    const second = buildContentSecurityPolicy({ nonce: 'two', development: false });
    expect(first).toContain(`'nonce-one'`);
    expect(second).toContain(`'nonce-two'`);
    expect(first).not.toBe(second);
  });
});

describe('Strict-Transport-Security', () => {
  it('lasts two years and covers subdomains, without preload', () => {
    expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=63072000; includeSubDomains');
    // `preload` submits the domain to a browser list and is hard to undo: not yet.
    expect(STRICT_TRANSPORT_SECURITY).not.toContain('preload');
  });
});
