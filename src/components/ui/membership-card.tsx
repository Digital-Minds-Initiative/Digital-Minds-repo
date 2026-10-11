import { cn } from '@/client/lib/utils';
import { DitherSeam } from '@/components/ui/dither-seam';
import { PixelMark } from '@/components/ui/pixel-mark';

/**
 * The face of the product: a lanyard badge with a dithered band, the club's real
 * mark, member name/role, the academic year in both calendars, points and cell
 * stamps. The band's dither pair follows the club's mood: Tech (`brand`→`deep`) or
 * Gem (`uqu-teal-blue`→`uqu-dark-cyan`).
 */
export interface MembershipCardProps {
  mood: 'tech' | 'gem';
  memberId: string;
  name: string;
  role: string;
  academicYear: string;
  points: number;
  stampsEarned: number;
  stampsTotal?: number;
  clubMarkSrc?: string;
  className?: string;
}

export function MembershipCard({
  mood,
  memberId,
  name,
  role,
  academicYear,
  points,
  stampsEarned,
  stampsTotal = 6,
  clubMarkSrc,
  className,
}: MembershipCardProps) {
  const from = mood === 'tech' ? 'var(--brand)' : 'var(--uqu-teal-blue)';
  const to = mood === 'tech' ? 'var(--deep)' : 'var(--uqu-dark-cyan)';
  const stampTone = mood === 'tech' ? 'bg-brand border-brand' : 'bg-gold border-gold';

  return (
    <div
      className={cn(
        'w-[300px] overflow-hidden rounded-card border border-line bg-surface',
        className,
      )}
    >
      <div className="relative h-[150px]">
        <DitherSeam
          from={from}
          to={to}
          cell={16}
          cols={19}
          rows={10}
          direction="v"
          className="absolute inset-0 h-full"
        />
        {/* eslint-disable-next-line better-tailwindcss/no-restricted-classes -- translate-x is physical; must pair with physical `left` to stay centered under RTL */}
        <div className="absolute top-3.5 left-1/2 h-2.5 w-9 -translate-x-1/2 rounded-full bg-canvas" />
        {clubMarkSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- fixed-size badge chip, not a content image
          <img
            src={clubMarkSrc}
            alt=""
            className="absolute end-4 top-[34px] h-10 rounded-md bg-paper-cream p-1.5"
          />
        ) : null}
        <div className="absolute start-4 bottom-3.5">
          <PixelMark glyph="plus" size={8} tone="deep" finish="perforated" />
        </div>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-muted uppercase [unicode-bidi:isolate]">
          {role}
        </span>
        <h3 className="font-serif text-[36px] leading-[48px] font-semibold">{name}</h3>
        <div className="flex items-end justify-between border-t border-line pt-3">
          <div>
            <div className="font-mono text-xs text-muted">العام الدراسي</div>
            <div className="font-semibold">{academicYear}</div>
          </div>
          <div className="text-end">
            <div className="font-mono text-xs text-muted">النقاط</div>
            <div className="font-mono text-[28px] leading-8 font-medium [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]">
              {points.toLocaleString('en')}
            </div>
          </div>
        </div>
        <div className="mt-1 flex justify-end gap-1.5" dir="ltr">
          {Array.from({ length: stampsTotal }, (_, i) => (
            <span
              key={i}
              className={cn(
                'block size-2 rounded-[1px] border',
                i < stampsEarned ? stampTone : 'border-control-border',
              )}
            />
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-3 font-mono text-[11px] text-muted uppercase">
          <span>Digital Minds</span>
          <span dir="ltr">ID {memberId} · SAMPLE</span>
        </div>
      </div>
    </div>
  );
}
