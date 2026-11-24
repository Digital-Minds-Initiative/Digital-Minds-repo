'use client';

import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useRef,
  useState,
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
import { withKashida } from '@/shared/lib/member-card';
import type { StickerKey, StickerPlacement } from '@/shared/lib/stickers';
import { cardRoleLabel } from '@/shared/lib/wallet-pass';

import { CellMosaic } from './cell-mosaic';
import { PanelArt } from './panel-art';
import { PassQr } from './pass-qr';
import { Sticker } from './sticker';
import { useCountUp, useFitScale, usePointerDepth, useSeenOnce } from '../hooks/use-badge-motion';
import { BADGE_MOSAIC_ROWS, badgeThemeFor, type BadgeTheme } from '../lib/badge-theme';

/** The badge is drawn at this size and scaled as a whole, so it is the same card on every screen. */
const WIDTH = 358;
const HEIGHT = 448;

const CLUB_LATIN: Record<string, string> = { tuwaiq: 'Tuwaiq Club', computing: 'UQU Computing' };

const FACE: CSSProperties = {
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

function Slot({ theme }: { theme: BadgeTheme }) {
  return (
    <div
      aria-hidden
      className="absolute top-[13px] h-2.5 w-[30px] rounded-full"
      style={{
        insetInlineStart: '50%',
        marginInlineStart: -15,
        background: theme.slot,
        boxShadow: 'inset 0 1px 2px color-mix(in oklab, black 45%, transparent)',
      }}
    />
  );
}

function Brand({ theme }: { theme: BadgeTheme }) {
  return (
    <div className="absolute inset-x-6 top-10 flex items-center gap-2.5" dir="ltr">
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
  return (
    <div className="flex gap-1.5" dir="ltr">
      {Array.from({ length: card.stampsTotal }, (_, index) => {
        const earned = index < card.stampsEarned;
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
              earned ? { background: theme.stamp } : { border: `1.5px solid ${theme.stampOff}` }
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
  const nameSize = card.fullName.length > 24 ? 24 : 30;
  const role = cardRoleLabel(card, walletPassAr);
  const latin = CLUB_LATIN[card.club.slug] ?? card.club.name;

  return (
    <>
      <Slot theme={theme} />
      <div
        className="absolute top-0"
        style={{ right: 0, translate: 'calc(var(--px, 0) * -7px) calc(var(--py, 0) * -7px)' }}
      >
        <CellMosaic
          rows={BADGE_MOSAIC_ROWS}
          palette={theme.mosaic}
          perforated={theme.mosaicPerforated}
        />
      </div>
      <Brand theme={theme} />

      <div className="absolute inset-x-6 top-[100px]">
        <div
          aria-label={card.fullName}
          className="max-w-full overflow-hidden tracking-[-0.005em] text-ellipsis whitespace-nowrap"
          style={{ fontSize: nameSize, lineHeight: 1.3, fontWeight: 500 }}
        >
          <span aria-hidden>{withKashida(card.fullName)}</span>
        </div>
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
        className="absolute inset-x-4 bottom-4 h-[214px] overflow-hidden rounded-[10px]"
        style={{ background: theme.panelBase, color: theme.panelText }}
      >
        <PanelArt theme={theme} />

        <div className="absolute inset-x-[18px] top-4 flex items-start justify-between">
          <div className="grid justify-items-end">
            <div className="text-xs font-semibold opacity-90">{t('points')}</div>
            <div
              className="font-mono text-[44px] leading-[1.05] font-medium [font-variant-numeric:lining-nums_tabular-nums]"
              dir="ltr"
            >
              {points.toLocaleString('en')}
            </div>
          </div>
          {/* The club's own logo, as the design system supplies it for this ground. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand mark */}
          <img
            src={theme.logo.src}
            alt={theme.logo.alt}
            className="block w-auto"
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

/** What the sticker editor changes on the card: where each sticker lies, which is picked, and the colour. */
export interface BadgeEditor {
  placements: readonly StickerPlacement[];
  selected: StickerKey | null;
  onSelect: (key: StickerKey | null) => void;
  /** A sticker was dragged: its new centre, as a fraction of the card. */
  onMove: (key: StickerKey, x: number, y: number) => void;
  onRemove: (key: StickerKey) => void;
  /** The colour being tried, before it is saved. */
  tone?: 'paper' | 'matte';
}

/** The sticker's diameter on the card at scale 1, in the card's own 358 x 448 pixels. */
const STICKER_SIZE = 96;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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
  const tName = useTranslations('walletPass.sticker');
  const size = STICKER_SIZE * placement.scale;
  const selected = editor?.selected === placement.key;
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const style: CSSProperties = {
    left: `${placement.x * WIDTH - size / 2}px`,
    top: `${placement.y * HEIGHT - size / 2}px`,
    width: size,
    height: size,
    transform: `rotate(${placement.rotation}deg)`,
    zIndex: placement.z + 1,
  };

  if (!editor) {
    return (
      <div className="absolute" style={style}>
        <Sticker stickerKey={placement.key} size={size} peel={placement.key === 'lead'} />
      </div>
    );
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!drag.current || !box) return;
    editor.onMove(
      placement.key,
      clamp01((event.clientX - box.left - drag.current.dx) / box.width),
      clamp01((event.clientY - box.top - drag.current.dy) / box.height),
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={t('pick', { name: tName(placement.key) })}
      className="absolute cursor-grab touch-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
      style={style}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = stage.current?.getBoundingClientRect();
        if (!box) return;
        // Where inside the sticker it was grabbed, so it does not jump to centre on its pointer.
        drag.current = {
          dx: event.clientX - box.left - placement.x * box.width,
          dy: event.clientY - box.top - placement.y * box.height,
        };
        editor.onSelect(placement.key);
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
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
          editor.onMove(
            placement.key,
            clamp01(placement.x + delta[0]),
            clamp01(placement.y + delta[1]),
          );
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          editor.onSelect(placement.key);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          editor.onRemove(placement.key);
        }
      }}
    >
      <Sticker stickerKey={placement.key} size={size} />
      {selected ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-1.5 rounded-[10px] border-[1.5px] border-dashed"
            style={{ borderColor: 'var(--tuwaiq-lilac)' }}
          />
          <button
            type="button"
            aria-label={t('remove')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              editor.onRemove(placement.key);
            }}
            className="absolute -end-3 -top-3 grid size-6 place-items-center rounded-full text-sm leading-none font-bold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{ background: 'var(--color-danger)', color: 'var(--color-danger-fg)' }}
          >
            ×
          </button>
        </>
      ) : null}
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

  return (
    <div ref={stageRef} className="absolute inset-0" onPointerDown={() => editor?.onSelect(null)}>
      <Slot theme={theme} />
      <div
        className="absolute top-0"
        style={{ right: 0, translate: 'calc(var(--px, 0) * -7px) calc(var(--py, 0) * -7px)' }}
      >
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

      <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4">
        <div
          className="grid justify-items-center gap-1 rounded-[10px] p-2"
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
          className="grid min-w-0 flex-1 justify-items-end gap-1 text-end"
          style={{ zIndex: 200 }}
        >
          <div
            className="font-mono text-[10px] tracking-[0.06em]"
            dir="ltr"
            style={{ color: theme.textMuted }}
          >
            {placements.length} / {card.stickers.length} · {card.hijriYear}
          </div>
          <div className="max-w-full truncate text-[17px] font-semibold">{card.fullName}</div>
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
 * hangs with a slow sway, leans toward the pointer with its layers at different depths, and turns
 * over like a leaf (ReactBits' Page Flip: 180 degrees, 0.55 s, ease in-out, perspective 1200).
 * Tap, click, Enter or Space turns it. Every motion is off under `prefers-reduced-motion`; the
 * badge is then just two faces you switch between.
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
  const [fitRef, scale] = useFitScale(WIDTH);
  const [stageRef, seen] = useSeenOnce<HTMLDivElement>();
  const { ref: depthRef, onPointerMove, onPointerLeave } = usePointerDepth<HTMLDivElement>(6);
  const [ownFlipped, setOwnFlipped] = useState(false);
  const flipped = controlledFlipped ?? ownFlipped;
  const points = useCountUp(card.points, seen);
  const s = scale ?? 1;
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
    <div ref={fitRef} className="grid w-full max-w-[358px] gap-3">
      <div
        ref={stageRef}
        style={{
          width: WIDTH * s,
          height: HEIGHT * s,
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            transform: `scale(${s})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            ref={depthRef}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            className="size-full"
            style={
              {
                perspective: 1200,
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
                className="size-full [transform-origin:50%_0] motion-safe:animate-[badge-sway_7s_ease-in-out_infinite] motion-safe:hover:[animation-play-state:paused]"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div
                  className="size-full"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: 'rotateX(var(--rx)) rotateY(var(--ry))',
                    transition: 'transform 180ms linear',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={flipped}
                    aria-label={flipped ? t('flipToFront') : t('flipToBack')}
                    onClick={editor ? undefined : flip}
                    onKeyDown={editor ? undefined : onKey}
                    className="relative size-full cursor-pointer rounded-[16px] outline-none [transition:transform_650ms_cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:[transition:none]"
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
                        background: theme.ground,
                        color: theme.text,
                        boxShadow: `inset 0 0 0 1px ${theme.ring}`,
                      }}
                    >
                      <Front card={card} theme={theme} seen={seen} points={points} />
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
                    </div>
                    <div
                      aria-hidden={!flipped}
                      inert={!flipped}
                      className="absolute inset-0 overflow-hidden rounded-[16px]"
                      style={{
                        ...FACE,
                        transform: 'rotateY(180deg)',
                        boxShadow: `inset 0 0 0 1px ${theme.ring}`,
                        background: theme.ground,
                        color: theme.text,
                      }}
                    >
                      <Back
                        card={card}
                        theme={theme}
                        placements={placements}
                        editor={editor}
                        stageRef={backRef}
                      />
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
  );
}
