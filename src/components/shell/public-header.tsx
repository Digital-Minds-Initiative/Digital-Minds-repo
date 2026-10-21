'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/client/lib/utils';
import { DELAYS } from '@/components/motion/delays';
import { ScrollProgress } from '@/components/motion/scroll-progress';

/**
 * The landing page's header: fixed to the top, with an empty block of the same height in the page
 * flow so nothing sits under it and nothing moves when it changes. It drops in on load, draws its
 * bottom line from the right, and once the page has scrolled 8px it gets shorter, blurs what is
 * behind it and swaps the line for a dashed pixel one — all of it over 200 ms. The scroll is
 * watched through a marker at the top of the page, not a scroll listener.
 */
export function PublicHeader({ logo, actions }: { logo: ReactNode; actions: ReactNode }) {
  const marker = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const element = marker.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={marker} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2" />
      <div aria-hidden className="h-16 sm:h-20 lg:h-[88px]" />
      <header
        data-scrolled={scrolled || undefined}
        className={cn(
          'group fixed inset-x-0 top-0 z-50 h-16 bg-surface-1 sm:h-20 lg:h-[88px]',
          'transition-[height,background-color,backdrop-filter] duration-200 ease-out motion-reduce:transition-none',
          'data-[scrolled]:h-14 data-[scrolled]:bg-surface-1/80 data-[scrolled]:backdrop-blur-md sm:data-[scrolled]:h-16 lg:data-[scrolled]:h-[68px]',
          'motion-safe:animate-[header-drop_0.5s_ease-out_both]',
        )}
      >
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
          <div
            className="motion-safe:animate-[header-item_0.4s_ease-out_backwards]"
            style={{ animationDelay: `${DELAYS.logo}ms` }}
          >
            {logo}
          </div>
          <div
            className="flex items-center gap-1.5 motion-safe:animate-[header-item_0.4s_ease-out_backwards] sm:gap-3"
            style={{ animationDelay: `${DELAYS.actions}ms` }}
          >
            {actions}
          </div>
        </div>
        {/* The bottom line draws from the right edge; once scrolled, a dashed pixel line shows over it. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px origin-right bg-border motion-safe:animate-[line-grow_0.6s_steps(24)_backwards]"
          style={{ animationDelay: `${DELAYS.headerLine}ms` }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-[repeating-linear-gradient(90deg,var(--tuwaiq-lilac)_0_4px,transparent_4px_8px)] opacity-0 transition-opacity duration-200 group-data-[scrolled]:opacity-60 motion-reduce:transition-none"
        />
        <ScrollProgress />
      </header>
    </>
  );
}
