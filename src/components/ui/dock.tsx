'use client';

import { useEffect, useRef } from 'react';

import { attachDock, iconCells, type IconName } from '@/lib/dm-engine';
import { cn } from '@/lib/utils';

/**
 * Floating navigation for compact screens: a few pixel icons on a dark slab that
 * grow toward the pointer, keeping 5 places within thumb's reach. Active item is
 * marked by a cell dot plus a background change — never colour alone.
 */
export interface DockItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  active?: boolean;
}

export interface DockProps {
  items: DockItem[];
  renderLink: (item: DockItem, children: React.ReactNode) => React.ReactNode;
  className?: string;
}

function DockIcon({ name }: { name: IconName }) {
  const cells = iconCells(name, 6);
  return (
    <svg viewBox="0 0 48 48" width={22} height={22} aria-hidden>
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.s} height={c.s} rx={c.rx} fill="currentColor" />
      ))}
    </svg>
  );
}

export function Dock({ items, renderLink, className }: DockProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return attachDock(root);
  }, []);

  return (
    <div
      ref={rootRef}
      role="navigation"
      aria-label="الرئيسية"
      className={cn(
        'absolute start-1/2 bottom-4 flex -translate-x-1/2 gap-2 rounded-card border border-slab-3 bg-slab p-2',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="group relative">
          {renderLink(
            item,
            <button
              type="button"
              data-dock-item
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'relative flex size-[52px] origin-bottom items-center justify-center rounded-md border-0 p-0 text-on-slab',
                'scale-[var(--s,1)] transition-transform duration-(--duration-base) ease-out',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tuwaiq-lilac',
                item.active && 'bg-slab-2',
              )}
            >
              <DockIcon name={item.icon} />
              {item.active && (
                <span
                  className="absolute bottom-1 size-1.5 rounded-[1px] bg-tuwaiq-lilac"
                  aria-hidden
                />
              )}
            </button>,
          )}
          <span
            className={cn(
              'pointer-events-none absolute start-1/2 bottom-[calc(100%+10px)] -translate-x-1/2 rounded-cell border border-paper-rule bg-paper-cream px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-on-paper opacity-0 transition-opacity duration-(--duration-fast) ease-out',
              'group-focus-within:opacity-100 group-hover:opacity-100',
            )}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
