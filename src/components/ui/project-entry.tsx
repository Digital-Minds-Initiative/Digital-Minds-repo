import type * as React from 'react';

import { StatusTag, type StatusTagProps } from '@/components/ui/status-tag';
import { cn } from '@/lib/utils';

/**
 * Student projects as an editorial track list — index code, Arabic title, English
 * title, team, status, date — never a card grid.
 */
export interface ProjectEntryRow {
  code: string;
  titleAr: string;
  descriptionAr: string;
  titleEn: string;
  team: string;
  status: Pick<StatusTagProps, 'label' | 'tone' | 'filled'>;
  date: string;
  href?: string;
}

export interface ProjectEntryListProps {
  groupLabel: string;
  rows: ProjectEntryRow[];
  renderRow?: (row: ProjectEntryRow, children: React.ReactNode) => React.ReactNode;
  className?: string;
}

export function ProjectEntryList({
  groupLabel,
  rows,
  renderRow,
  className,
}: ProjectEntryListProps) {
  return (
    <div className={cn(className)}>
      <span className="mb-3 block font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-muted uppercase [unicode-bidi:isolate]">
        {groupLabel}
      </span>
      <div className="mb-3 h-0.5 w-6 bg-ink" />
      {rows.map((row) => {
        const content = (
          <div
            key={row.code}
            className="grid grid-cols-[40px_1.4fr_1fr_150px_130px_90px] items-center gap-4 border-b border-line py-3"
          >
            <span className="font-mono text-xs text-muted" dir="ltr">
              {row.code}
            </span>
            <div>
              <h3 className="font-serif text-xl leading-[30px] font-semibold">{row.titleAr}</h3>
              <small className="block text-xs leading-[18px] font-normal text-muted">
                {row.descriptionAr}
              </small>
            </div>
            <span className="text-end text-sm text-muted" dir="ltr">
              {row.titleEn}
            </span>
            <span className="truncate text-sm text-muted">{row.team}</span>
            <StatusTag {...row.status} />
            <span className="font-mono text-xs text-muted" dir="ltr">
              {row.date}
            </span>
          </div>
        );
        return renderRow ? renderRow(row, content) : content;
      })}
    </div>
  );
}
