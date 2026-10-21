import { Children, type ElementType, type ReactNode } from 'react';

import { Reveal, type RevealVariant } from './reveal';

/**
 * A list whose items come in one after another (`step` milliseconds apart) when it first scrolls
 * into view. Each child becomes one item, wrapped in the tag given as `itemAs`.
 */
export function Stagger({
  children,
  step = 100,
  variant = 'up',
  as: Tag = 'div',
  itemAs,
  className,
  itemClassName,
  reverse = false,
}: {
  children: ReactNode;
  step?: number;
  variant?: RevealVariant;
  as?: ElementType;
  itemAs?: ElementType;
  className?: string;
  itemClassName?: string;
  /** Start from the last item. */
  reverse?: boolean;
}) {
  const items = Children.toArray(children);
  return (
    <Tag className={className}>
      {items.map((child, index) => (
        <Reveal
          key={index}
          as={itemAs ?? 'div'}
          variant={variant}
          delay={(reverse ? items.length - 1 - index : index) * step}
          className={itemClassName}
        >
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}
