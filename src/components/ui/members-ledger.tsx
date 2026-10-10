import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Members affairs: a searchable ledger with the same index-code rhythm as the
 * project list. Columns (RTL order): id · name + college · membership type ·
 * committee · points (figure, LTR tabular) · stamps (six cells, gold when earned) ·
 * joined (Hijri spec).
 */
export interface MembersLedgerRow {
  id: string;
  name: string;
  college: string;
  membershipType: string;
  committee: string;
  points: number;
  stampsEarned: number;
  stampsTotal?: number;
  joined: string;
  selected?: boolean;
}

export interface MembersLedgerFilter {
  key: string;
  label: string;
  active?: boolean;
}

export interface MembersLedgerProps {
  searchPlaceholder: string;
  filters: MembersLedgerFilter[];
  rows: MembersLedgerRow[];
  onImport?: () => void;
  onAdd?: () => void;
  importLabel: string;
  addLabel: string;
  className?: string;
}

export function MembersLedger({
  searchPlaceholder,
  filters,
  rows,
  onImport,
  onAdd,
  importLabel,
  addLabel,
  className,
}: MembersLedgerProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-55 items-center rounded-md border border-control-border bg-surface px-3 text-sm text-muted">
          {searchPlaceholder}
        </span>
        {filters.map((f) => (
          <span
            key={f.key}
            className={cn(
              'flex h-8 items-center rounded-pill border border-line px-3 text-[13px] font-semibold',
              f.active ? 'border-ink bg-ink text-canvas' : 'bg-surface',
            )}
          >
            {f.label}
          </span>
        ))}
        <div className="flex-1" />
        <Button variant="secondary" onClick={onImport}>
          {importLabel}
        </Button>
        <Button onClick={onAdd}>{addLabel}</Button>
      </div>
      <table className="w-full border-collapse border border-line bg-surface">
        <thead>
          <tr>
            {['ID', 'الاسم', 'نوع العضوية', 'اللجنة', 'النقاط', 'الأختام', 'الانضمام'].map((h) => (
              <th
                key={h}
                className="bg-surface-sunken p-2 px-3 text-start text-[13px] font-semibold text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="border-t border-line p-3 text-sm">
                <span
                  className={cn(
                    row.selected && 'rounded-[2px] bg-brand px-1.5 py-0.5 text-primary-fg',
                  )}
                >
                  {row.id}
                </span>
              </td>
              <td className="border-t border-line p-3 text-sm">
                <div className="text-[15px] font-semibold">{row.name}</div>
                <small className="block text-xs font-normal text-muted">{row.college}</small>
              </td>
              <td className="border-t border-line p-3 text-sm">{row.membershipType}</td>
              <td className="border-t border-line p-3 text-sm">{row.committee}</td>
              <td className="border-t border-line p-3 text-end text-sm">
                <span className="font-mono text-lg font-medium [font-variant-numeric:tabular-nums] [direction:ltr]">
                  {row.points.toLocaleString('en')}
                </span>
              </td>
              <td className="border-t border-line p-3 text-sm">
                <span className="flex gap-0.5" dir="ltr">
                  {Array.from({ length: row.stampsTotal ?? 6 }, (_, i) => (
                    <i
                      key={i}
                      className={cn(
                        'block size-2 rounded-[2px] border border-control-border not-italic',
                        i < row.stampsEarned && 'border-gold bg-gold',
                      )}
                    />
                  ))}
                </span>
              </td>
              <td className="border-t border-line p-3 font-mono text-xs text-muted" dir="ltr">
                {row.joined}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
