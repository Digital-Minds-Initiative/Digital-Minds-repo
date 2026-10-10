'use client';

import { useState } from 'react';

import { cn } from '@/client/lib/utils';
import { Button } from '@/components/ui/button';
import { PaperSheet } from '@/components/ui/paper-sheet';
import { SpecLabel } from '@/components/ui/spec-label';
import { StatusTag } from '@/components/ui/status-tag';

/**
 * Anyone can check a membership by its number — one field, one button, one honest
 * answer. Always shows a "CHECKED {date}" spec line regardless of outcome, so an
 * answer is never mistaken for a guarantee.
 */
export interface VerifyRecord {
  name: string;
  role: string;
  club: string;
  since: string;
}

export interface VerifyProps {
  lookup: (id: string) => VerifyRecord | null;
  checkedAt: string;
  notFoundMessage: string;
  className?: string;
}

export function Verify({ lookup, checkedAt, notFoundMessage, className }: VerifyProps) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<VerifyRecord | null | undefined>(undefined);

  function check() {
    setResult(lookup(value.trim().toUpperCase()) ?? null);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <label htmlFor="verify-id" className="text-sm leading-5 font-semibold">
        رقم العضوية
      </label>
      <div className="flex gap-2">
        <input
          id="verify-id"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
          placeholder="TWQ-0001"
          dir="ltr"
          className={cn(
            'h-11 flex-1 rounded-md border border-control-border bg-surface px-3 font-mono text-sm font-medium tracking-[0.06em] text-ink outline-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            result === null && 'border-error',
          )}
        />
        <Button onClick={check}>تحقّق</Button>
      </div>
      {result === null && (
        <p className="text-[13px] leading-5 font-medium text-error">{notFoundMessage}</p>
      )}
      {result && (
        <PaperSheet
          code={result.role}
          titleAr={result.name}
          titleEn={`${result.role} · ${result.club}`}
          seed={result.name + result.since}
          width={260}
          height={220}
        />
      )}
      {result && (
        <div className="flex items-center gap-2">
          <StatusTag label="موثّق" tone="success" filled={4} />
          <SpecLabel>SINCE {result.since}</SpecLabel>
        </div>
      )}
      <SpecLabel>CHECKED {checkedAt}</SpecLabel>
    </div>
  );
}
