import { cn } from '@/client/lib/utils';

/**
 * A word plus four cells that fill with progress — status is never colour alone.
 * `filled` is how many of the 4 cells are on (0-4); `archived` draws them dashed
 * instead of solid-outline for the zero-fill case.
 */
export interface StatusTagProps {
  label: string;
  tone: 'muted' | 'info' | 'warning' | 'success';
  filled: 0 | 1 | 2 | 3 | 4;
  archived?: boolean;
  className?: string;
}

const TONE_CLASS: Record<StatusTagProps['tone'], string> = {
  muted: 'bg-muted border-muted',
  info: 'bg-info border-info',
  warning: 'bg-warning border-warning',
  success: 'bg-success border-success',
};

export function StatusTag({ label, tone, filled, archived = false, className }: StatusTagProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[30px] items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink',
        className,
      )}
    >
      <span className="inline-flex gap-0.5" dir="ltr">
        {Array.from({ length: 4 }, (_, i) => {
          const on = i < filled;
          return (
            <i
              key={i}
              className={cn(
                'block size-[5px] rounded-[1px] border border-control-border not-italic',
                on && !archived && TONE_CLASS[tone],
                archived && 'border-dashed',
              )}
            />
          );
        })}
      </span>
      {label}
    </span>
  );
}
