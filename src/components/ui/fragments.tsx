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
  kind: 'lib' | 'chart' | 'photo' | 'note';
  tiltDeg: number;
  top: number;
  /** Distance from the reading-direction start edge (right in RTL) — never physical `left`. */
  start: number;
  content: React.ReactNode;
}

const KIND_CLASS: Record<FragmentPiece['kind'], string> = {
  lib: 'w-full lg:w-[206px] min-h-[180px] lg:min-h-[244px] bg-paper-teal p-3.5',
  chart: 'w-full lg:w-[290px] min-h-[150px] lg:min-h-[206px] bg-paper-peach p-3.5',
  photo: 'w-full lg:w-[300px] min-h-[170px] lg:min-h-[236px] bg-paper-cream p-3',
  note: 'w-full lg:w-[176px] min-h-[110px] lg:min-h-[128px] bg-paper-lilac p-3',
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
      className={cn(
        'static cursor-grab touch-none rounded-cell border border-paper-rule text-on-paper select-none',
        'outline-offset-[3px] transition-[transform] duration-(--duration-slow) ease-out focus-visible:outline-2 focus-visible:outline-tuwaiq-lilac',
        'lg:absolute',
        KIND_CLASS[piece.kind],
      )}
      style={{ top: piece.top, insetInlineStart: piece.start }}
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
        'relative flex cursor-grab flex-col gap-4 bg-deep p-4 text-on-deep',
        'lg:block lg:h-[620px] lg:gap-0 lg:overflow-hidden lg:p-0',
        className,
      )}
    >
      <div className="relative z-10 lg:p-8">{header}</div>
      {pieces.map((piece) => (
        <Piece key={piece.key} piece={piece} />
      ))}
      <div
        ref={dotRef}
        className="pointer-events-none absolute z-[99999] size-3.5 rounded-full bg-tuwaiq-lilac opacity-0 transition-opacity duration-(--duration-fast) ease-out"
      />
    </div>
  );
}
