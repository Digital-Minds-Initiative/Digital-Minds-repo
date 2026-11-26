'use client';

import { Minus, MoveDiagonal2, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '@/client/lib/utils';
import { MARK_MASK_STYLE } from '@/components/shell/logo';
import walletPassAr from '@/i18n/messages/ar/walletPass.json';
import type { MemberCard } from '@/shared/contracts/wallet';
import { POINTS_PER_STAMP } from '@/shared/lib/member-card';
import { PLACEMENT_LIMITS, type StickerRef, type StickerPlacement } from '@/shared/lib/stickers';
import { cardRoleLabel } from '@/shared/lib/wallet-pass';

import { CellMosaic } from './cell-mosaic';
import { FitFigure } from './fit-figure';
import { FitName } from './fit-name';
import { PanelArt } from './panel-art';
import { PassQr } from './pass-qr';
import { Sticker } from './sticker';
import {
  prefersReducedMotion,
  useCountUp,
  useFitScale,
  usePointerDepth,
  useSeenOnce,
} from '../hooks/use-badge-motion';
import { StickerDefsContext, useStickerDef, useStickerText } from '../hooks/use-sticker-text';
import { BADGE_MOSAIC_ROWS, badgeThemeFor, type BadgeTheme } from '../lib/badge-theme';
import { formatFigure } from '../lib/number-fit';

/** The badge is drawn at this size and scaled as a whole, so it is the same card on every screen. */
const WIDTH = 358;
const HEIGHT = 448;

const CLUB_LATIN: Record<string, string> = { tuwaiq: 'Tuwaiq Club', computing: 'UQU Computing' };

const FACE: CSSProperties = {
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/** A colourway change in flight: the theme it leaves and the screen point the wave starts from. */
interface Ink {
  from: BadgeTheme;
  /** Where the press happened, in viewport pixels; the card's own upper middle when there was none. */
  client: { x: number; y: number } | null;
}

/**
 * How far the wave travels, in the card's own pixels: past the farthest corner and out of the
 * band, so at the end nothing of it is left on the card.
 */
const WAVE_REACH = 860;
/** The band of swirling colour that rides the front of the wave. */
const BAND = 190;
/** Where the new dress comes in behind the band's leading half. */
const SEAM = 95;

const WAVE_R = `calc(var(--wave) * ${WAVE_REACH}px)`;
/** The new dress shows inside the wave, its edge hidden under the band. */
const DRESS_MASK = `radial-gradient(circle at var(--ix) var(--iy), #000 calc(${WAVE_R} - ${SEAM}px), transparent calc(${WAVE_R} - ${SEAM - 55}px))`;
/** The band: nothing, then colour, then nothing again, as a ring around the wave's front. */
const BAND_MASK = `radial-gradient(circle at var(--ix) var(--iy), transparent calc(${WAVE_R} - ${BAND}px), #000 calc(${WAVE_R} - ${BAND * 0.55}px), #000 calc(${WAVE_R} - ${BAND * 0.2}px), transparent ${WAVE_R})`;

/**
 * The colours the band swirls through: the new dress's own light (the blobs of its panel and its
 * accent), so a white badge turning matte is washed by indigo and lilac and not by a generic blue.
 */
function bandBackground(theme: BadgeTheme): string {
  const [a, b, c] = theme.panelBlobs;
  return [
    `radial-gradient(55% 55% at 18% 28%, ${a}, transparent 70%)`,
    `radial-gradient(60% 60% at 82% 22%, ${theme.accent}, transparent 70%)`,
    `radial-gradient(60% 60% at 70% 85%, ${b}, transparent 72%)`,
    `radial-gradient(50% 50% at 25% 80%, ${c}, transparent 70%)`,
    `linear-gradient(135deg, ${theme.panelBase}, ${a})`,
  ].join(', ');
}

/** Film grain over the band, the way ReactBits' Grainient dusts its gradient. */
function BandGrain({ id }: { id: string }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
      style={{ mixBlendMode: 'overlay', opacity: 0.85 }}
    >
      <filter id={id}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.85"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix
          type="matrix"
          values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"
        />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

/**
 * One face of the badge dressed in `theme`. While the colourway changes it keeps the old dress
 * underneath and lets the new one come in behind a wave that starts at the point that was pressed:
 * a wide band of drifting, grainy gradient in the new colours, its edge rippling like liquid (an
 * SVG displacement), in the spirit of ReactBits' Grainient background. Both dresses are the same
 * content drawn twice for a second and a half, so every detail changes colour in the same wave.
 */
function InkFace({
  theme,
  ink,
  mirror,
  onDone,
  children,
}: {
  theme: BadgeTheme;
  ink: Ink | null;
  /** The face is seen from behind (the card is turned the other way), so left and right swap. */
  mirror: boolean;
  onDone: () => void;
  /** `underlay` is true for the old dress, which is only to be looked at. */
  children: (theme: BadgeTheme, underlay: boolean) => ReactNode;
}) {
  const warpId = useId();
  const grainId = useId();
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !ink) return;
      const box = node.getBoundingClientRect();
      const fx = ink.client && box.width > 0 ? (ink.client.x - box.left) / box.width : 0.5;
      const fy = ink.client && box.height > 0 ? (ink.client.y - box.top) / box.height : 0.3;
      // Drawn a third of the way toward the middle, so no corner of the card is left for last.
      const toward = (v: number) => v + (0.5 - v) * 0.33;
      const x = toward(Math.min(1.05, Math.max(-0.05, mirror ? 1 - fx : fx)));
      const y = toward(Math.min(1.05, Math.max(-0.05, fy)));
      node.style.setProperty('--ix', `${(x * WIDTH).toFixed(1)}px`);
      node.style.setProperty('--iy', `${(y * HEIGHT).toFixed(1)}px`);
    },
    [ink, mirror],
  );

  const dress = (t: BadgeTheme): CSSProperties => ({ background: t.ground, color: t.text });
  const wave = 'motion-safe:animate-[badge-ink_1700ms_cubic-bezier(0.45,0.1,0.25,1)_both]';

  return (
    <>
      {ink ? (
        <div aria-hidden inert className="absolute inset-0 isolate" style={dress(ink.from)}>
          {children(ink.from, true)}
        </div>
      ) : null}
      <div
        ref={ink ? place : undefined}
        className={cn('absolute inset-0 isolate', ink && wave)}
        style={{
          ...dress(theme),
          ...(ink ? { maskImage: DRESS_MASK, WebkitMaskImage: DRESS_MASK } : null),
        }}
        onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
          if (ink && event.target === event.currentTarget) onDone();
        }}
      >
        {children(theme, false)}
      </div>
      {ink ? (
        <>
          <svg aria-hidden width="0" height="0" className="absolute">
            <filter id={warpId} x="-15%" y="-15%" width="130%" height="130%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.009 0.014"
                numOctaves="2"
                seed="7"
                result="noise"
              >
                <animate
                  attributeName="baseFrequency"
                  dur="2.4s"
                  values="0.009 0.014;0.016 0.01;0.009 0.014"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="78"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 motion-reduce:hidden"
            style={{ filter: `url(#${warpId})` }}
          >
            <div
              ref={place}
              className={cn('absolute inset-0', wave)}
              style={{ maskImage: BAND_MASK, WebkitMaskImage: BAND_MASK }}
            >
              <div
                className="absolute inset-0 motion-safe:animate-[badge-flow_2.6s_ease-in-out_infinite_alternate]"
                style={{ background: bandBackground(theme), backgroundSize: '220% 220%' }}
              />
              <BandGrain id={grainId} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function Brand({ theme }: { theme: BadgeTheme }) {
  return (
    <div className="absolute inset-x-6 top-6 flex items-center gap-2.5" dir="ltr">
      <span
        aria-hidden
        className="block h-[30px] w-auto shrink-0"
        style={{ ...MARK_MASK_STYLE, background: theme.mark }}
      />
      <span className="font-mono text-[15px] font-medium">Digital Minds</span>
    </div>
  );
}

function Stamps({ card, theme, seen }: { card: MemberCard; theme: BadgeTheme; seen: boolean }) {
  const t = useTranslations('walletPass');
  return (
    <div
      className="flex gap-1.5"
      dir="ltr"
      role="img"
      aria-label={t('stampsAria', { earned: card.stampsEarned, total: card.stampsTotal })}
      title={t('stampsUnit', { points: POINTS_PER_STAMP })}
    >
      {Array.from({ length: card.stampsTotal }, (_, index) => {
        const earned = index < card.stampsEarned;
        const half = !earned && card.stampsHalf && index === card.stampsEarned;
        const newest = earned && index === card.stampsEarned - 1;
        return (
          <span
            key={index}
            className={cn(
              'block size-[13px] rounded-[2px]',
              newest &&
                seen &&
                'motion-safe:animate-[badge-stamp_220ms_var(--ease-out)_1.1s_backwards]',
            )}
            style={
              earned
                ? { background: theme.stamp }
                : half
                  ? {
                      border: `1.5px solid ${theme.stampOff}`,
                      // The box is half filled: the points toward the next one are half of what it takes.
                      background: `linear-gradient(to right, ${theme.stamp} 50%, transparent 50%)`,
                    }
                  : { border: `1.5px solid ${theme.stampOff}` }
            }
          />
        );
      })}
    </div>
  );
}

/** The front: logo and name, role, and the gradient panel with the points. */
function Front({
  card,
  theme,
  seen,
  points,
}: {
  card: MemberCard;
  theme: BadgeTheme;
  seen: boolean;
  points: number;
}) {
  const t = useTranslations('walletPass');
  const role = cardRoleLabel(card, walletPassAr);
  const latin = CLUB_LATIN[card.club.slug] ?? card.club.name;

  return (
    <>
      <div className="absolute top-0" style={{ right: 0 }}>
        <CellMosaic
          rows={BADGE_MOSAIC_ROWS}
          palette={theme.mosaic}
          perforated={theme.mosaicPerforated}
        />
      </div>
      <Brand theme={theme} />

      <div className="absolute inset-x-6 top-[72px]">
        <FitName name={card.fullName} size={30} min={22} />
        <div
          className="mt-2.5 text-[21px] leading-[1.3] font-semibold"
          style={{ color: theme.accent }}
        >
          {role}
        </div>
        <div
          className="mt-2.5 flex justify-end gap-2.5 font-mono text-[10px] tracking-[0.06em] uppercase"
          dir="ltr"
          style={{ color: theme.textMuted }}
        >
          <span>{latin}</span>
          <span>·</span>
          <span>{card.hijriYear}</span>
        </div>
      </div>

      <div
        className="absolute inset-x-4 bottom-4 h-[236px] overflow-hidden rounded-[10px]"
        style={{ background: theme.panelBase, color: theme.panelText }}
      >
        <PanelArt theme={theme} />

        <div className="absolute inset-x-[18px] top-4 flex items-start justify-between">
          {/* The label and the figure share one edge, so 7, 70 and 7,000 all sit flush with it. */}
          <div className="grid min-w-0 flex-1">
            <div
              className="text-end text-xs font-semibold opacity-90"
              style={{ textAlign: 'right' }}
            >
              {t('points')}
            </div>
            <FitFigure shown={formatFigure(points)} final={formatFigure(card.points)} base={44} />
          </div>
          {/* The club's own logo, as the design system supplies it for this ground. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand mark */}
          <img
            src={theme.logo.src}
            alt={theme.logo.alt}
            className="ms-3 block w-auto shrink-0"
            style={{ height: theme.logo.height, marginTop: -2 }}
          />
        </div>

        <div className="absolute inset-x-[18px] bottom-4 flex items-end justify-between">
          <div className="grid max-w-[190px] justify-items-end gap-[9px]">
            <div
              className="line-clamp-2 text-end text-[11.5px]"
              style={{ color: theme.panelTextMuted }}
            >
              {card.committees.length > 0 ? card.committees.join(' · ') : t('noCommittees')}
            </div>
            <Stamps card={card} theme={theme} seen={seen} />
          </div>
          <div
            className="grid justify-items-center gap-1 rounded-lg p-1.5"
            style={{ background: theme.chip }}
          >
            <div className="size-[58px]">
              <PassQr value={card.qr} label={card.memberCode} color={theme.chipInk} />
            </div>
            <span
              className="font-mono text-[7px] tracking-[0.03em]"
              dir="ltr"
              style={{ color: theme.chipInk }}
            >
              {card.memberCode}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

/** A change of size and/or turn to one sticker. */
type StickerAdjust = Partial<Pick<StickerPlacement, 'rotation' | 'scale'>>;

/** What the sticker editor changes on the card: where each sticker lies, which is picked, and the colour. */
export interface BadgeEditor {
  placements: readonly StickerPlacement[];
  selected: StickerRef | null;
  onSelect: (key: StickerRef | null) => void;
  /** A sticker was dragged: its new centre, as a fraction of the card. */
  onMove: (key: StickerRef, x: number, y: number) => void;
  onRemove: (key: StickerRef) => void;
  /** A sticker was resized or turned from its handle on the card, or from the keyboard. */
  onAdjust: (key: StickerRef, change: StickerAdjust) => void;
  /** The colour being tried, before it is saved. */
  tone?: 'paper' | 'matte';
  /** Where the colour was pressed (viewport pixels): the ink drops from there when it changes. */
  inkOrigin?: { x: number; y: number };
}

/** The sticker's diameter on the card at scale 1, in the card's own 358 x 448 pixels. */
const STICKER_SIZE = 96;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The sticker lane on the back, in the card's own pixels: under the logo and above the QR and the
 * name. A sticker lives wholly inside it, so none can cover what the card itself says.
 */
const LANE = { top: 74, bottom: 316 } as const;

/** Where a sticker is really drawn: its centre pulled in so the whole sticker stays in the lane. */
function inLane(placement: Pick<StickerPlacement, 'x' | 'y' | 'scale'>): { x: number; y: number } {
  const reach = (STICKER_SIZE * placement.scale) / 2 + 4;
  const clampTo = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
  return {
    x: clampTo(placement.x * WIDTH, reach, WIDTH - reach) / WIDTH,
    y: clampTo(placement.y * HEIGHT, LANE.top + reach, LANE.bottom - reach) / HEIGHT,
  };
}

/** The round controls on a picked sticker, in card pixels: big enough for a finger. */
const HANDLE_SIZE = 38;

/** Keeps a drag with the element it began on; a pointer that has already ended cannot be held, and that is no error. */
function holdPointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // A tap that ended before this ran: there is nothing left to follow.
  }
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** One sticker on the back: still, or — when the card is being edited — one to pick up and move. */
function PlacedSticker({
  placement,
  editor,
  stage,
}: {
  placement: StickerPlacement;
  editor: BadgeEditor | undefined;
  /** The element the card's fractions are measured against. */
  stage: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('wallet.editor');
  const text = useStickerText();
  const custom = useStickerDef(placement.key);
  const selected = editor?.selected === placement.key;
  const at = inLane(placement);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const grip = useRef<{ cx: number; cy: number; k: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { rotation, scale } = PLACEMENT_LIMITS;

  // Drawn at one size and scaled, so the size slider eases instead of jumping, and the position
  // and turn ease too (never while a finger or the pointer is dragging it: that must follow 1:1).
  const style: CSSProperties = {
    left: `${at.x * WIDTH - STICKER_SIZE / 2}px`,
    top: `${at.y * HEIGHT - STICKER_SIZE / 2}px`,
    width: STICKER_SIZE,
    height: STICKER_SIZE,
    transform: `rotate(${placement.rotation}deg) scale(${placement.scale})`,
    zIndex: placement.z + 1,
  };
  const settle =
    'transition-[left,top,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none data-[dragging=true]:transition-none';
  // The controls stay one size on the card however big or small the sticker is made.
  const counter = (origin: string): CSSProperties => ({
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    transform: `translate(${origin}) scale(${1 / placement.scale})`,
  });

  if (!editor) {
    return (
      <div className="absolute" style={style}>
        <Sticker
          stickerKey={placement.key}
          custom={custom}
          size={STICKER_SIZE}
          peel={placement.key === 'lead'}
        />
      </div>
    );
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!drag.current || !box) return;
    const next = inLane({
      x: clamp01((event.clientX - box.left - drag.current.dx) / box.width),
      y: clamp01((event.clientY - box.top - drag.current.dy) / box.height),
      scale: placement.scale,
    });
    editor.onMove(placement.key, next.x, next.y);
  };
  const drop = (event: PointerEvent<HTMLElement>) => {
    drag.current = null;
    grip.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // The corner handle: how far it is from the sticker's middle is the size, and which way it
  // points is the turn, so one drag does both, as on any photo editor.
  const gripDown = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    holdPointer(event.currentTarget, event.pointerId);
    grip.current = {
      cx: box.left + at.x * box.width,
      cy: box.top + at.y * box.height,
      k: box.width / WIDTH,
    };
    setDragging(true);
    editor.onSelect(placement.key);
  };
  const gripMove = (event: PointerEvent<HTMLElement>) => {
    const g = grip.current;
    if (!g) return;
    const dx = event.clientX - g.cx;
    const dy = event.clientY - g.cy;
    const reach = Math.hypot(dx, dy) / g.k;
    // The handle sits on the bottom-right corner, 45 degrees from straight right.
    const turn = (((Math.atan2(dy, dx) * 180) / Math.PI - 45 + 540) % 360) - 180;
    editor.onAdjust(placement.key, {
      scale: Math.min(
        scale.max,
        Math.max(scale.min, roundTo(reach / (STICKER_SIZE * Math.SQRT1_2), 0.02)),
      ),
      rotation: Math.min(rotation.max, Math.max(rotation.min, Math.round(turn))),
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={t('pick', { name: text.name(placement.key, custom) })}
      data-dragging={dragging}
      className={cn(
        // The whole square is the grip, corners included: no rounding, or the corners would not catch a press.
        'absolute cursor-grab touch-none rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing',
        settle,
      )}
      style={style}
      onPointerDown={(event) => {
        event.stopPropagation();
        holdPointer(event.currentTarget, event.pointerId);
        const box = stage.current?.getBoundingClientRect();
        if (!box) return;
        // Where inside the sticker it was grabbed, so it does not jump to centre on its pointer.
        drag.current = {
          dx: event.clientX - box.left - at.x * box.width,
          dy: event.clientY - box.top - at.y * box.height,
        };
        setDragging(true);
        editor.onSelect(placement.key);
      }}
      onPointerMove={move}
      onPointerUp={drop}
      onPointerCancel={drop}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const step = event.shiftKey ? 0.05 : 0.015;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = moves[event.key];
        if (delta) {
          event.preventDefault();
          const next = inLane({
            x: clamp01(at.x + delta[0]),
            y: clamp01(at.y + delta[1]),
            scale: placement.scale,
          });
          editor.onMove(placement.key, next.x, next.y);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          editor.onSelect(placement.key);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          editor.onRemove(placement.key);
        } else if (event.key === '+' || event.key === '=' || event.key === '-') {
          event.preventDefault();
          editor.onAdjust(placement.key, {
            scale: Math.min(
              scale.max,
              Math.max(scale.min, placement.scale + (event.key === '-' ? -0.05 : 0.05)),
            ),
          });
        } else if (event.key === '[' || event.key === ']') {
          event.preventDefault();
          editor.onAdjust(placement.key, {
            rotation: Math.min(
              rotation.max,
              Math.max(rotation.min, placement.rotation + (event.key === '[' ? -3 : 3)),
            ),
          });
        }
      }}
    >
      {/* It drops onto the card when stuck, and lifts off it while it is being carried. */}
      <div
        className={cn(
          'size-full motion-safe:animate-[sticker-stick_420ms_var(--ease-out)_backwards]',
          'transition-[scale,filter] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
          dragging &&
            'scale-110 [filter:drop-shadow(0_8px_6px_color-mix(in_oklab,black_35%,transparent))]',
        )}
      >
        <Sticker stickerKey={placement.key} custom={custom} size={STICKER_SIZE} />
      </div>
      {selected ? (
        <>
          <svg
            aria-hidden
            viewBox="0 0 108 108"
            className="pointer-events-none absolute -inset-1.5 size-[calc(100%+12px)] motion-safe:animate-[selection-pop_180ms_var(--ease-out)_both]"
          >
            <rect
              x="1"
              y="1"
              width="106"
              height="106"
              rx="14"
              fill="none"
              stroke="var(--tuwaiq-lilac)"
              strokeWidth="1.6"
              strokeDasharray="5 3"
              className="motion-safe:animate-[selection-march_900ms_linear_infinite]"
            />
          </svg>
          {/* Size and turn: the bottom-right corner. */}
          <button
            type="button"
            aria-label={t('resize')}
            onPointerDown={gripDown}
            onPointerMove={gripMove}
            onPointerUp={drop}
            onPointerCancel={drop}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              const keys: Record<string, StickerAdjust> = {
                ArrowUp: { scale: Math.min(scale.max, placement.scale + 0.05) },
                ArrowDown: { scale: Math.max(scale.min, placement.scale - 0.05) },
                ArrowRight: { rotation: Math.min(rotation.max, placement.rotation + 3) },
                ArrowLeft: { rotation: Math.max(rotation.min, placement.rotation - 3) },
              };
              const change = keys[event.key];
              if (!change) return;
              event.preventDefault();
              event.stopPropagation();
              editor.onAdjust(placement.key, change);
            }}
            className="absolute grid cursor-nwse-resize touch-none place-items-center rounded-full shadow-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:animate-[selection-pop_220ms_var(--ease-out)_90ms_both]"
            style={{
              ...counter('50%, 50%'),
              right: 0,
              bottom: 0,
              border: '2px solid var(--badge-white)',
              background: 'var(--tuwaiq-lilac)',
              color: 'var(--badge-ink)',
            }}
          >
            <MoveDiagonal2 aria-hidden className="size-5" strokeWidth={2.6} />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** How far one press of a toolbar button changes the picked sticker. */
const TOOLBAR_WIDTH = 214;
const TOOLBAR_HEIGHT = 44;

const TOOL_STEP = { scale: 0.08, rotation: 6 } as const;

/**
 * A toolbar button that does its thing once when pressed and keeps doing it while it is held, so a
 * sticker can be eased bigger or turned a long way without a hundred presses.
 */
function HoldButton({
  label,
  disabled,
  onStep,
  children,
}: {
  label: string;
  disabled?: boolean;
  onStep: () => void;
  children: ReactNode;
}) {
  const latest = useRef(onStep);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    latest.current = onStep;
  });
  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0 || disabled) return;
        latest.current();
        stop();
        timer.current = window.setTimeout(() => {
          timer.current = window.setInterval(() => latest.current(), 60);
        }, 340);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // A key press arrives as a click with no pointer: the press above already covered the mouse.
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0) onStep();
      }}
      className="grid size-9 cursor-pointer place-items-center rounded-full transition-[background-color,transform] duration-150 outline-none hover:[background-color:color-mix(in_oklab,var(--badge-canvas)_16%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/**
 * The controls of the picked sticker, on the card itself, right under it (above it when it is low
 * on the card): turn it either way, make it smaller or bigger, take it off. The corner handle
 * does the same by dragging; this is for exact, repeatable steps and for a keyboard or a finger.
 */
function StickerToolbar({
  placement,
  editor,
}: {
  placement: StickerPlacement;
  editor: BadgeEditor;
}) {
  const t = useTranslations('wallet.editor');
  const { rotation, scale } = PLACEMENT_LIMITS;
  const at = inLane(placement);
  const reach = (STICKER_SIZE * placement.scale) / 2 + 22;
  const below = at.y * HEIGHT + reach + 6;
  const top =
    below + TOOLBAR_HEIGHT > HEIGHT - 8 ? at.y * HEIGHT - reach - TOOLBAR_HEIGHT - 6 : below;
  const left = Math.min(
    WIDTH - TOOLBAR_WIDTH / 2 - 6,
    Math.max(TOOLBAR_WIDTH / 2 + 6, at.x * WIDTH),
  );
  const clampRotation = (value: number) => Math.min(rotation.max, Math.max(rotation.min, value));
  const clampScale = (value: number) =>
    Math.min(scale.max, Math.max(scale.min, Math.round(value * 100) / 100));

  return (
    <div
      role="toolbar"
      aria-label={t('toolbar.label')}
      dir="ltr"
      className="absolute flex items-center gap-0.5 rounded-full p-1 shadow-lg motion-safe:animate-[selection-pop_180ms_var(--ease-out)_both]"
      style={{
        zIndex: 300,
        top,
        left,
        width: TOOLBAR_WIDTH,
        height: TOOLBAR_HEIGHT,
        translate: '-50% 0',
        background: 'var(--badge-ink)',
        color: 'var(--badge-canvas)',
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <HoldButton
        label={t('toolbar.turnLeft')}
        disabled={placement.rotation <= rotation.min}
        onStep={() =>
          editor.onAdjust(placement.key, {
            rotation: clampRotation(placement.rotation - TOOL_STEP.rotation),
          })
        }
      >
        <RotateCcw aria-hidden className="size-4" />
      </HoldButton>
      <HoldButton
        label={t('toolbar.turnRight')}
        disabled={placement.rotation >= rotation.max}
        onStep={() =>
          editor.onAdjust(placement.key, {
            rotation: clampRotation(placement.rotation + TOOL_STEP.rotation),
          })
        }
      >
        <RotateCw aria-hidden className="size-4" />
      </HoldButton>
      <span
        aria-hidden
        className="mx-0.5 h-5 w-px"
        style={{ background: 'color-mix(in oklab, var(--badge-canvas) 25%, transparent)' }}
      />
      <HoldButton
        label={t('toolbar.smaller')}
        disabled={placement.scale <= scale.min}
        onStep={() =>
          editor.onAdjust(placement.key, { scale: clampScale(placement.scale - TOOL_STEP.scale) })
        }
      >
        <Minus aria-hidden className="size-4" />
      </HoldButton>
      <HoldButton
        label={t('toolbar.larger')}
        disabled={placement.scale >= scale.max}
        onStep={() =>
          editor.onAdjust(placement.key, { scale: clampScale(placement.scale + TOOL_STEP.scale) })
        }
      >
        <Plus aria-hidden className="size-4" />
      </HoldButton>
      <span
        aria-hidden
        className="mx-0.5 h-5 w-px"
        style={{ background: 'color-mix(in oklab, var(--badge-canvas) 25%, transparent)' }}
      />
      <HoldButton label={t('remove')} onStep={() => editor.onRemove(placement.key)}>
        <Trash2 aria-hidden className="size-4" />
      </HoldButton>
    </div>
  );
}

/** The back: the stickers the member stuck on, and the QR that opens their page. */
function Back({
  card,
  theme,
  placements,
  editor,
  stageRef,
}: {
  card: MemberCard;
  theme: BadgeTheme;
  placements: readonly StickerPlacement[];
  editor: BadgeEditor | undefined;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const tWallet = useTranslations('wallet');
  const empty = placements.length === 0;
  const picked = placements.find((placement) => placement.key === editor?.selected) ?? null;

  return (
    <div ref={stageRef} className="absolute inset-0" onPointerDown={() => editor?.onSelect(null)}>
      <div className="absolute top-0" style={{ right: 0 }}>
        <CellMosaic
          rows={BADGE_MOSAIC_ROWS}
          palette={theme.mosaic}
          perforated={theme.mosaicPerforated}
        />
      </div>
      <Brand theme={theme} />

      {empty ? (
        <p
          className="absolute inset-x-10 top-[150px] m-0 text-center text-sm leading-7"
          style={{ color: theme.textMuted }}
        >
          {editor ? tWallet('back.emptyEditing') : tWallet('back.empty')}
        </p>
      ) : null}
      {placements.map((placement) => (
        <PlacedSticker key={placement.key} placement={placement} editor={editor} stage={stageRef} />
      ))}
      {editor && picked ? <StickerToolbar placement={picked} editor={editor} /> : null}

      <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4">
        <div
          className="pointer-events-none grid justify-items-center gap-1 rounded-[10px] p-2"
          style={{ background: theme.chip, color: theme.chipInk, zIndex: 200 }}
        >
          <div className="size-[76px]">
            <PassQr value={card.qr} label={card.memberCode} color={theme.chipInk} />
          </div>
          <span className="font-mono text-[8px] tracking-[0.05em]" dir="ltr">
            {card.memberCode}
          </span>
        </div>
        <div
          className="pointer-events-none grid min-w-0 flex-1 justify-items-end gap-1 text-end"
          style={{ zIndex: 200 }}
        >
          <div
            className="font-mono text-[10px] tracking-[0.06em]"
            dir="ltr"
            style={{ color: theme.textMuted }}
          >
            {placements.length} / {card.stickers.length} · {card.hijriYear}
          </div>
          <FitName
            name={card.fullName}
            size={17}
            min={13}
            weight={600}
            stretch={false}
            labelled={false}
          />
          <div className="text-xs" style={{ color: theme.textMuted }}>
            {card.share.enabled ? tWallet('back.scan') : tWallet('back.private')}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One member's badge, front and back. It unfolds from its top edge when it comes into view,
 * floats a few pixels on a slow breath (it never tilts by itself, so it always sits square on the
 * page), leans toward the pointer with its layers at different depths, and turns over like a leaf
 * (ReactBits' Page Flip: 180 degrees, ease in-out) from far enough back that it stays flat.
 * Changing between the white and the matte colourway spreads the new colour over the old as a drop
 * of ink. Tap, click, Enter or Space turns it. Every motion is off under `prefers-reduced-motion`;
 * the badge is then just two faces you switch between.
 */
export function MemberBadge({
  card,
  extra,
  editor,
  flipped: controlledFlipped,
  onFlippedChange,
}: {
  card: MemberCard;
  extra?: ReactNode;
  /** Present while the member is arranging stickers: the card then does not turn when touched. */
  editor?: BadgeEditor;
  /** Controlled turning, for a screen that has to show a given side. */
  flipped?: boolean;
  onFlippedChange?: (flipped: boolean) => void;
}) {
  const t = useTranslations('wallet');
  const theme = badgeThemeFor({ mood: card.mood, tone: editor?.tone ?? card.tone });
  const backRef = useRef<HTMLDivElement | null>(null);
  /** Where the old dress's copy of the back keeps its ref, so it never steals the live one. */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [fitRef, scale] = useFitScale(WIDTH);
  const [stageRef, seenInView] = useSeenOnce<HTMLDivElement>();
  // In the editor the badge is the whole point of the window: it is there at once, not when scrolled to.
  const seen = seenInView || editor !== undefined;
  const { ref: depthRef, onPointerMove, onPointerLeave } = usePointerDepth<HTMLDivElement>(6);
  const [ownFlipped, setOwnFlipped] = useState(false);
  const flipped = controlledFlipped ?? ownFlipped;
  // The colourway in view, and the one it is changing from while the ink spreads. Derived while
  // rendering, so the old dress is already underneath on the very frame the new one arrives.
  const [shown, setShown] = useState(theme);
  const [ink, setInk] = useState<Ink | null>(null);
  if (shown !== theme) {
    setShown(theme);
    setInk(prefersReducedMotion() ? null : { from: shown, client: editor?.inkOrigin ?? null });
  }
  const endInk = useCallback(() => setInk(null), []);
  const points = useCountUp(card.points, seen);
  const s = scale ?? 1;
  const defs = useMemo(
    () =>
      new Map(
        card.stickers.flatMap((sticker) =>
          sticker.custom ? [[sticker.key, sticker.custom] as const] : [],
        ),
      ),
    [card.stickers],
  );
  const placements: readonly StickerPlacement[] =
    editor?.placements ?? card.stickers.flatMap((sticker) => sticker.placement ?? []);

  const flip = () => {
    setOwnFlipped(!flipped);
    onFlippedChange?.(!flipped);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flip();
    }
  };

  return (
    <StickerDefsContext.Provider value={defs}>
      <div ref={fitRef} className="grid w-full max-w-[358px] gap-3">
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            width: WIDTH * s,
            height: HEIGHT * s,
            visibility: scale === null ? 'hidden' : 'visible',
          }}
        >
          {/* Pinned to the stage's left edge, whatever the text direction: in a right-to-left page a
            box wider than its stage hangs off the left, and scaling it from there pushed the card
            out of its frame on every phone. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              transform: `scale(${s})`,
              transformOrigin: 'top left',
            }}
          >
            <div
              ref={depthRef}
              onPointerMove={editor ? undefined : onPointerMove}
              onPointerLeave={editor ? undefined : onPointerLeave}
              className="size-full"
              style={
                {
                  perspective: 2600,
                  '--px': 0,
                  '--py': 0,
                  '--rx': '0deg',
                  '--ry': '0deg',
                  '--lit': 0,
                } as CSSProperties
              }
            >
              <div
                className={cn(
                  'size-full [transform-origin:50%_0]',
                  seen
                    ? 'motion-safe:animate-[badge-unfold_900ms_cubic-bezier(0.2,0.8,0.2,1)_both]'
                    : 'opacity-0 motion-reduce:opacity-100',
                )}
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div
                  className={cn(
                    'size-full',
                    !editor &&
                      'motion-safe:animate-[badge-float_6s_ease-in-out_infinite] motion-safe:hover:[animation-play-state:paused]',
                  )}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div
                    className="size-full"
                    style={{
                      transformStyle: 'preserve-3d',
                      transform: 'rotateX(var(--rx)) rotateY(var(--ry))',
                      transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={flipped}
                      aria-label={flipped ? t('flipToFront') : t('flipToBack')}
                      onClick={editor ? undefined : flip}
                      onKeyDown={editor ? undefined : onKey}
                      className="relative size-full cursor-pointer rounded-[16px] outline-none [transition:transform_700ms_cubic-bezier(0.45,0,0.15,1)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:[transition:none]"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: `rotateY(${flipped ? 180 : 0}deg)`,
                      }}
                    >
                      <div
                        aria-hidden={flipped}
                        inert={flipped}
                        className="absolute inset-0 overflow-hidden rounded-[16px]"
                        style={{
                          ...FACE,
                          boxShadow: `inset 0 0 0 1px ${theme.ring}`,
                          transition: 'box-shadow 600ms ease-out',
                        }}
                      >
                        <InkFace theme={theme} ink={ink} mirror={flipped} onDone={endInk}>
                          {(dress) => (
                            <>
                              <Front card={card} theme={dress} seen={seen} points={points} />
                              <div
                                aria-hidden
                                className="pointer-events-none absolute inset-0"
                                style={{
                                  opacity: 'var(--lit)',
                                  mixBlendMode: 'soft-light',
                                  transition: 'opacity 200ms linear',
                                  background:
                                    'radial-gradient(circle at var(--mx, 50%) var(--my, 30%), color-mix(in oklab, white 55%, transparent), transparent 55%)',
                                }}
                              />
                            </>
                          )}
                        </InkFace>
                      </div>
                      <div
                        aria-hidden={!flipped}
                        inert={!flipped}
                        className="absolute inset-0 overflow-hidden rounded-[16px]"
                        style={{
                          ...FACE,
                          transform: 'rotateY(180deg)',
                          boxShadow: `inset 0 0 0 1px ${theme.ring}`,
                          transition: 'box-shadow 600ms ease-out',
                        }}
                      >
                        <InkFace theme={theme} ink={ink} mirror={!flipped} onDone={endInk}>
                          {(dress, underlay) => (
                            <Back
                              card={card}
                              theme={dress}
                              placements={placements}
                              editor={underlay ? undefined : editor}
                              stageRef={underlay ? ghostRef : backRef}
                            />
                          )}
                        </InkFace>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={flip}
          className="inline-flex items-center justify-center gap-2 rounded-control border border-control-border px-3 py-2 text-sm text-fg outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <RotateCw aria-hidden className="size-4" />
          {flipped ? t('flipToFront') : t('flipToBack')}
        </button>
        {extra}
      </div>
    </StickerDefsContext.Provider>
  );
}
