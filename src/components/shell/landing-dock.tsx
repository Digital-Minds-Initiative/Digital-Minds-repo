'use client';

import { Dock, type DockItem } from '@/components/ui/dock';

/** Thin client wrapper: `Dock`'s `renderLink` is a function, which a server page can't pass directly. */
export function LandingDock({ items, className }: { items: DockItem[]; className?: string }) {
  return (
    <Dock
      items={items}
      className={className}
      renderLink={(item, children) => <a href={item.href}>{children}</a>}
    />
  );
}
