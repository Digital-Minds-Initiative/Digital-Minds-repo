import { cn } from '@/client/lib/utils';

/**
 * Loose paper folders, overlapped like files tossed on a desk: a soft back with a tab, a lighter
 * front panel carrying an Arabic title and a small mono label. The whole stack scales with its
 * container (percentages and container-query units), so it needs no breakpoints. Folders float
 * gently and lift on hover; both stop under `prefers-reduced-motion`.
 */
export type FolderTone = 'indigo' | 'lilac' | 'orange';

export interface FolderItem {
  key: string;
  title: string;
  label: string;
  tone: FolderTone;
}

const TONES: Record<FolderTone, string> = {
  indigo:
    'text-on-deep [--folder-back:var(--tuwaiq-indigo)] [--folder-front:color-mix(in_oklab,var(--tuwaiq-indigo)_78%,var(--tuwaiq-lilac))]',
  lilac:
    'text-deep [--folder-back:color-mix(in_oklab,var(--tuwaiq-lilac)_80%,var(--tuwaiq-indigo))] [--folder-front:var(--tuwaiq-lilac)]',
  orange:
    'text-deep [--folder-back:color-mix(in_oklab,var(--tuwaiq-orange)_78%,var(--club-orange))] [--folder-front:var(--tuwaiq-orange)]',
};

interface Spot {
  place: string;
  tilt: string;
  delay: string;
}

/** Where each folder sits in the stack; any folder past the third shares the last spot. */
const SPOTS: readonly Spot[] = [
  { place: 'top-0 start-[6%] z-10', tilt: '-rotate-6', delay: '0s' },
  { place: 'top-[30%] start-[42%] z-20', tilt: 'rotate-4', delay: '-2s' },
  { place: 'top-[56%] start-[8%] z-30', tilt: '-rotate-3', delay: '-4s' },
];
const LAST_SPOT: Spot = { place: 'top-[56%] start-[8%] z-30', tilt: '-rotate-3', delay: '-4s' };

function Folder({ item, spot }: { item: FolderItem; spot: Spot }) {
  return (
    <li
      className={cn(
        'absolute w-[52%] drop-shadow-[0_18px_24px_color-mix(in_oklab,var(--deep)_28%,transparent)]',
        'motion-safe:animate-[folder-float_7s_ease-in-out_infinite]',
        spot.place,
      )}
      style={{ animationDelay: spot.delay }}
    >
      <div
        className={cn(
          '[container-type:inline-size] relative',
          'transition-transform duration-(--duration-slow) ease-out motion-safe:hover:-translate-y-2 motion-safe:hover:scale-[1.03]',
          spot.tilt,
          TONES[item.tone],
        )}
      >
        <svg viewBox="0 0 240 190" className="block w-full" aria-hidden>
          <path
            d="M14 30a12 12 0 0 1 12-12h62l16 16h112a12 12 0 0 1 12 12v118a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12z"
            className="fill-(--folder-back)"
          />
          <rect x="6" y="52" width="228" height="132" rx="14" className="fill-(--folder-front)" />
          <rect
            x="6"
            y="52"
            width="228"
            height="12"
            rx="6"
            className="fill-paper-cream opacity-30"
          />
        </svg>
        <div className="absolute inset-x-[3%] top-[30%] bottom-0 flex flex-col items-center justify-center gap-[2cqw] text-center">
          <span className="font-sans text-[13cqw] leading-tight font-bold">{item.title}</span>
          <span className="font-mono text-[5cqw] tracking-[0.2em] uppercase opacity-80 [direction:ltr] [unicode-bidi:isolate]">
            {item.label}
          </span>
        </div>
      </div>
    </li>
  );
}

export function FolderStack({ items, className }: { items: FolderItem[]; className?: string }) {
  return (
    <ul
      className={cn('relative m-0 aspect-[5/4.4] w-full list-none p-0', className)}
      // The folders are the content; the list keeps them in reading order for assistive tech.
    >
      {items.map((item, index) => (
        <Folder key={item.key} item={item} spot={SPOTS[index] ?? LAST_SPOT} />
      ))}
    </ul>
  );
}
