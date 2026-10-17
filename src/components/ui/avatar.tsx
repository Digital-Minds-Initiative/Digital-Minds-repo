import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/client/lib/utils';

const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
  {
    variants: {
      size: {
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-12 text-base',
      },
      tone: {
        primary: 'bg-primary-subtle text-primary-subtle-fg',
        neutral: 'bg-surface-3 text-fg-muted',
      },
    },
    defaultVariants: { size: 'md', tone: 'primary' },
  },
);

/**
 * The initials of a name: the first letter of its first two words (one word gives its first two
 * letters). Arabic has no capitals, so letters are taken as they are.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [first = '', second] = words;
  const letters = second
    ? [...first].slice(0, 1).concat([...second].slice(0, 1))
    : [...first].slice(0, 2);
  return letters.join('');
}

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  /** The person's full name: shown as initials, and kept out of the accessibility tree (the name is next to it). */
  name: string;
  className?: string;
}

/** A small round marker with a person's initials, for lists where a name needs a face. */
export function Avatar({ name, size, tone, className }: AvatarProps) {
  return (
    <span aria-hidden data-slot="avatar" className={cn(avatarVariants({ size, tone }), className)}>
      {initialsOf(name)}
    </span>
  );
}
