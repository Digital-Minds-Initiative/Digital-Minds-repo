import type { LucideIcon, LucideProps } from 'lucide-react';

import { cn } from '@/client/lib/utils';

/**
 * For icons that point somewhere (arrows, chevrons): pass the LTR icon and it mirrors in RTL.
 * `ChevronRight` means "forward" — it points left in Arabic. Non-directional icons don't need this.
 */
export function DirectionalIcon({
  icon: Icon,
  className,
  ...props
}: LucideProps & { icon: LucideIcon }) {
  return <Icon aria-hidden className={cn('rtl:-scale-x-100', className)} {...props} />;
}
