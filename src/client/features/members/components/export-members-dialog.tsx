'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { apiClient, ApiError } from '@/client/lib/api-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import {
  MEMBER_EXPORT_MAX_ROWS,
  memberExportEndpoint,
  type MemberExportBodyInput,
  type MemberExportColumn,
  type MemberExportSelection,
} from '@/shared/contracts/members-export';

/**
 * The columns in the order the table shows them: the name cell carries the university email, and
 * the role badge sits in the membership type's cell. The server also accepts `registered` and
 * `status`; the picker does not offer them.
 */
const COLUMN_ORDER: readonly MemberExportColumn[] = [
  'fullName',
  'uniEmail',
  'membershipType',
  'role',
  'committees',
  'points',
  'phone',
  'personalEmail',
  'college',
  'major',
  'level',
  'joinedAt',
];

/** Always ticked when the dialog opens: who the row is. */
const IDENTITY_COLUMNS: readonly MemberExportColumn[] = ['fullName', 'uniEmail'];

/** Only the columns the picker offers can start ticked. */
function isExportColumn(id: string): id is MemberExportColumn {
  return (COLUMN_ORDER as readonly string[]).includes(id);
}

export interface ExportMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  /** The table's filters and sort, without the page and the club. */
  filters: NonNullable<MemberExportBodyInput['filters']>;
  selection: MemberExportSelection;
  /** Ids of the table's visible columns: those that are export columns start ticked. */
  visibleColumnIds: readonly string[];
  /** Ticked members the server no longer lists, to untick them (`entries_rejected`). */
  onRejected: (memberIds: string[]) => void;
}

/** Picks the columns and downloads the members export (docs/adr/0025-members-export.md). */
export function ExportMembersDialog({
  open,
  onOpenChange,
  clubId,
  filters,
  selection,
  visibleColumnIds,
  onRejected,
}: ExportMembersDialogProps) {
  const t = useTranslations('members.export');
  const tColumns = useTranslations('membersExport.columns');
  const tErrors = useTranslations('common.errors');
  const [columns, setColumns] = useState<ReadonlySet<MemberExportColumn>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Start from the table's visible columns each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setColumns(new Set([...IDENTITY_COLUMNS, ...visibleColumnIds.filter(isExportColumn)]));
    }
  }

  function toggle(column: MemberExportColumn, checked: boolean) {
    const next = new Set(columns);
    if (checked) next.add(column);
    else next.delete(column);
    setColumns(next);
  }

  async function exportFile() {
    setExporting(true);
    try {
      const file = await apiClient.requestFile(memberExportEndpoint, {
        params: { clubId },
        body: {
          columns: COLUMN_ORDER.filter((column) => columns.has(column)),
          filters,
          selection,
        },
      });
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename ?? 'members.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(t('done'));
      onOpenChange(false);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        toast.error(tErrors('INTERNAL'));
      } else if (error.details.reason === 'entries_rejected' && selection.kind === 'ids') {
        const rejected = (error.details.issues ?? []).flatMap((issue) => {
          const index = issue.path[3];
          const id = typeof index === 'number' ? selection.memberIds[index] : undefined;
          return id === undefined ? [] : [id];
        });
        onRejected(rejected);
        toast.error(t('rejected', { count: rejected.length }));
        onOpenChange(false);
      } else if (error.details.reason === 'too_many_rows') {
        toast.error(t('tooManyRows', { max: MEMBER_EXPORT_MAX_ROWS }));
      } else if (error.code === 'RATE_LIMITED') {
        const minutes = Math.max(1, Math.ceil((error.details.retryAfterSeconds ?? 60) / 60));
        toast.error(t('rateLimited', { minutes }));
      } else {
        toast.error(tErrors(error.code));
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !exporting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {selection.kind === 'ids'
              ? t('descriptionIds', { count: selection.memberIds.length })
              : t('descriptionAll')}
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-labelledby="export-members-columns" className="grid gap-2">
          <div className="mb-2 flex items-center gap-2">
            <span id="export-members-columns" className="text-sm font-medium">
              {t('columns')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={() => setColumns(new Set(COLUMN_ORDER))}
            >
              {t('selectAll')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setColumns(new Set())}>
              {t('clear')}
            </Button>
          </div>
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {COLUMN_ORDER.map((column) => {
              const id = `export-members-column-${column}`;
              return (
                <label
                  key={column}
                  htmlFor={id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-1 px-3 text-sm transition-colors hover:bg-surface-2 has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary-subtle has-data-[state=checked]:font-medium has-data-[state=checked]:text-primary-subtle-fg"
                >
                  <Checkbox
                    id={id}
                    checked={columns.has(column)}
                    onCheckedChange={(checked) => toggle(column, checked === true)}
                  />
                  <span className="truncate">{tColumns(column)}</span>
                </label>
              );
            })}
          </div>
          {columns.size === 0 ? (
            <p className="text-sm text-danger" role="alert">
              {t('noColumns')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={exporting} onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            loading={exporting}
            disabled={columns.size === 0}
            onClick={() => void exportFile()}
          >
            <Download aria-hidden />
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
