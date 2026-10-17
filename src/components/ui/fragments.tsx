'use client';

import { useEffect, useRef } from 'react';

import { attachCursor, attachDrag } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * An archive page: student work as loose pieces of paper you can pick up and
 * move. Dark `deep` board; each piece has its own resting tilt, straightens and
 * lifts on pick-up, settles back on release; arrow keys move the focused piece.
 */
export interface FragmentPiece {
  key: string;
  kind: 'lib' | 'chart' | 'photo' | 'note' | 'custom';
  tiltDeg: number;
  top: number;
  /** Distance from the reading-direction start edge (right in RTL) — never physical `left`. */
  start: number;
  content: React.ReactNode;
  /**
   * `custom` pieces bring their own paper (see `ScrapPaper`): no frame here. Size them with
   * `className`, which applies from the desktop board up.
   */
  className?: string;
  /** Resting stacking order; some scraps sit behind the notes until picked up. */
  z?: number;
  /** Small decorative scraps are left out of the stacked grid below the desktop board. */
  desktopOnly?: boolean;
}

const KIND_CLASS: Record<FragmentPiece['kind'], string> = {
  lib: 'w-full lg:w-[206px] min-h-[180px] lg:min-h-[244px] bg-paper-teal p-3.5',
  chart: 'w-full lg:w-[290px] min-h-[150px] lg:min-h-[206px] bg-paper-peach p-3.5',
  photo: 'w-full lg:w-[300px] min-h-[170px] lg:min-h-[236px] bg-paper-cream p-3',
  note: 'w-full lg:w-[176px] min-h-[110px] lg:min-h-[128px] bg-paper-lilac p-3',
  custom: 'lg:w-fit',
};

function Piece({ piece }: { piece: FragmentPiece }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachDrag(el, piece.tiltDeg);
  }, [piece.tiltDeg]);

  return (
    <div
      ref={ref}
      data-piece={piece.key}
      className={cn(
        'static mx-auto w-full max-w-md text-on-paper select-none sm:mx-0 sm:max-w-none',
        piece.kind !== 'custom' && 'rounded-cell border border-paper-rule',
        piece.desktopOnly && 'hidden lg:block',
        // Only the desktop board is a free-form canvas; on smaller screens the pieces sit in a
        // grid and must not capture touch scrolling.
        'lg:cursor-grab lg:touch-none',
        'outline-offset-[3px] transition-[transform] duration-(--duration-slow) ease-out focus-visible:outline-2 focus-visible:outline-tuwaiq-lilac focus-visible:outline-solid',
        'lg:absolute lg:mx-0 lg:max-w-none',
        KIND_CLASS[piece.kind],
        piece.className,
      )}
      style={{ top: piece.top, insetInlineStart: piece.start, zIndex: piece.z }}
    >
      {piece.content}
    </div>
  );
}

export interface FragmentsProps {
  pieces: FragmentPiece[];
  header: React.ReactNode;
  className?: string;
}

export function Fragments({ pieces, header, className }: FragmentsProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const board = boardRef.current;
    const dot = dotRef.current;
    if (!board || !dot) return;
    return attachCursor(board, dot);
  }, []);

  return (
    <div
      ref={boardRef}
      className={cn(
        'relative grid gap-5 overflow-hidden bg-hero p-4 text-on-hero sm:grid-cols-2 sm:p-6',
        'lg:block lg:h-[800px] lg:cursor-grab lg:gap-0 lg:p-0',
        className,
      )}
    >
      <div className="relative z-10 pb-2 sm:col-span-2 lg:p-8">{header}</div>
      {/* Desktop: a centred 880px canvas the pieces are placed on; elsewhere it dissolves into the grid. */}
      <div className="contents lg:absolute lg:inset-x-0 lg:inset-y-0 lg:mx-auto lg:block lg:w-[min(100%,1040px)]">
        {pieces.map((piece) => (
          <Piece key={piece.key} piece={piece} />
        ))}
      </div>
      <div
        ref={dotRef}
        className="pointer-events-none absolute z-[99999] size-3.5 rounded-full bg-tuwaiq-lilac opacity-0 transition-opacity duration-(--duration-fast) ease-out"
      />
    </div>
  );
}
