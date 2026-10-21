// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Reveal } from '../reveal';
import { Stagger } from '../stagger';

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
let callbacks: Callback[] = [];

beforeEach(() => {
  callbacks = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: Callback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Reveal', () => {
  it('waits to be seen, then is marked once and stays marked', () => {
    render(<Reveal delay={200}>hello</Reveal>);
    const element = screen.getByText('hello');
    expect(element.hasAttribute('data-revealed')).toBe(false);
    expect(element.getAttribute('data-reveal')).toBe('up');
    expect(element.style.getPropertyValue('--reveal-delay')).toBe('200ms');

    act(() => callbacks[0]?.([{ isIntersecting: false }]));
    expect(element.hasAttribute('data-revealed')).toBe(false);
    act(() => callbacks[0]?.([{ isIntersecting: true }]));
    expect(element.hasAttribute('data-revealed')).toBe(true);
  });

  it('keeps a clipped element whole on the outside, so it can be seen', () => {
    render(<Reveal variant="clip">line</Reveal>);
    const inner = screen.getByText('line');
    expect(inner.hasAttribute('data-clip')).toBe(true);
    expect(inner.parentElement?.hasAttribute('data-reveal-clip')).toBe(true);
    expect(inner.parentElement?.hasAttribute('data-reveal')).toBe(false);
  });

  it('marks everything at once where there is no observer', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Reveal>now</Reveal>);
    expect(screen.getByText('now').hasAttribute('data-revealed')).toBe(true);
  });
});

describe('Stagger', () => {
  it('spaces its items by the step, and can run them from the last', () => {
    render(
      <>
        <Stagger step={100} itemClassName="a">
          <span>one</span>
          <span>two</span>
        </Stagger>
        <Stagger step={100} reverse itemClassName="b">
          <span>three</span>
          <span>four</span>
        </Stagger>
      </>,
    );
    const delay = (text: string) =>
      (screen.getByText(text).parentElement as HTMLElement).style.getPropertyValue(
        '--reveal-delay',
      );
    expect([delay('one'), delay('two')]).toEqual(['0ms', '100ms']);
    expect([delay('three'), delay('four')]).toEqual(['100ms', '0ms']);
  });
});
