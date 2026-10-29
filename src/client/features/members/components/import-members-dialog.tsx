'use client';

import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MEMBER_IMPORT_MAX_BYTES,
  MEMBER_IMPORT_MAX_ROWS,
  committeeMemberImportTemplateEndpoint,
  memberImportColumns,
  memberImportTemplateEndpoint,
  type MemberImportIssue,
  type MemberImportResult,
  type MemberImportRow,
  type MemberImportStatus,
  type PreviewMemberImportResponse,
} from '@/shared/contracts/members-import';

import { useConfirmMemberImport, usePreviewMemberImport } from '../hooks/use-member-actions';
import type { AdmittingCommittee } from '../lib/access';
import { useCommitteeLabel } from '../lib/committee-label';

export interface ImportMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clubs the person may import into (officers and full admins). */
  clubs: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Without a club to import into: the committees the person leads, one of which the file goes
   * into, with «عضو» for anyone new (docs/adr/0029-leads-add-members.md).
   */
  committees?: readonly AdmittingCommittee[];
}

interface PickedFile {
  name: string;
  bytes: number;
  /** Base64, which is how the API takes a file (ADR 0021). */
  base64: string;
}

type Step =
  | { name: 'file' }
  | { name: 'preview'; preview: PreviewMemberImportResponse; changed: boolean }
  | { name: 'done'; result: MemberImportResult };

const STATUS_VARIANT: Record<MemberImportStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  add: 'success',
  restore: 'info',
  join: 'info',
  existing: 'neutral',
  invalid: 'danger',
};

const FIELD_LABELS = [
  'fullName',
  'uniEmail',
  'phone',
  'personalEmail',
  'college',
  'major',
  'level',
  'membershipType',
  'committees',
  'row',
] as const;
type FieldLabel = (typeof FIELD_LABELS)[number];

const ISSUE_CODES = [
  'required',
  'invalid_name',
  'invalid_email',
  'email_domain_not_allowed',
  'invalid_personal_email',
  'invalid_phone',
  'invalid_level',
  'too_many_committees',
  'duplicate_in_file',
  'unknown_membership_type',
  'unknown_committee',
  'committee_archived',
  'committee_not_target',
  'name_differs',
] as const;
type IssueCode = (typeof ISSUE_CODES)[number];

const FILE_ERROR_CODES = [
  'file_too_large',
  'too_many_rows',
  'unsupported_encoding',
  'unparsable_csv',
  'empty_file',
  'invalid_base64',
] as const;
type FileErrorCode = (typeof FILE_ERROR_CODES)[number];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      // "data:text/csv;base64,<payload>"
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Imports a club's members from a CSV in three steps that follow the API's two (ADR 0021): pick the
 * file, read the preview — what every row would do, nothing saved — and confirm. The confirmation
 * carries the preview's checksum; if the club or the file moved since, the server refuses it and
 * the preview is read again and shown, so what is confirmed is always what was seen.
 */
export function ImportMembersDialog(props: ImportMembersDialogProps) {
  // Mounted only while open, so every opening starts from the first step.
  return props.open ? <ImportMembersFlow {...props} /> : null;
}

function ImportMembersFlow({ onOpenChange, clubs, committees = [] }: ImportMembersDialogProps) {
  const t = useTranslations('members.import');
  const format = useFormatter();
  const errorText = useErrorText();
  const committeeLabel = useCommitteeLabel(committees);
  // A club to import into wins; a lead without one imports into a committee they lead.
  const intoCommittee = clubs.length === 0;
  const [clubId, setClubId] = useState(clubs[0]?.id ?? '');
  const [committeeId, setCommitteeId] = useState(committees[0]?.id ?? '');
  const committee = committees.find((candidate) => candidate.id === committeeId);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [step, setStep] = useState<Step>({ name: 'file' });
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = intoCommittee ? { committeeId } : { clubId };
  const preview = usePreviewMemberImport(target);
  const confirm = useConfirmMemberImport(target);
  const templateHref = intoCommittee
    ? committeeMemberImportTemplateEndpoint.path.replace(':committeeId', committeeId)
    : memberImportTemplateEndpoint.path.replace(':clubId', clubId);
  const busy = preview.isPending || confirm.isPending || reading;

  /** The words for a failed preview: the file's own problems first, then the generic ones. */
  function failure(caught: unknown): string {
    if (caught instanceof ApiError && caught.status === 422) {
      const issue = caught.details.issues?.[0];
      if (issue?.code === 'missing_column') {
        const field = String(issue.path.at(-1)) as keyof typeof memberImportColumns;
        const column = memberImportColumns[field]?.[0] ?? '';
        return t('errors.missing_column', { column });
      }
      if (issue && (FILE_ERROR_CODES as readonly string[]).includes(issue.code)) {
        return t(`errors.${issue.code as FileErrorCode}`);
      }
      return t('errors.unknown');
    }
    return errorText(caught);
  }

  async function pick(picked: File | undefined) {
    setError(null);
    if (!picked) return;
    if (picked.size > MEMBER_IMPORT_MAX_BYTES) {
      setFile(null);
      setError(t('errors.fileTooLarge'));
      return;
    }
    setReading(true);
    try {
      setFile({ name: picked.name, bytes: picked.size, base64: await readAsBase64(picked) });
    } catch {
      setFile(null);
      setError(t('errors.readFailed'));
    } finally {
      setReading(false);
    }
  }

  async function runPreview() {
    if (!file) return;
    setError(null);
    try {
      const result = await preview.mutateAsync(file.base64);
      setOnlyProblems(false);
      setStep({ name: 'preview', preview: result, changed: false });
    } catch (caught) {
      setError(failure(caught));
    }
  }

  async function runConfirm(current: PreviewMemberImportResponse) {
    if (!file) return;
    setError(null);
    try {
      const result = await confirm.mutateAsync({ file: file.base64, checksum: current.checksum });
      setStep({ name: 'done', result });
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 409 &&
        caught.details.reason === 'import_changed'
      ) {
        // Something moved since the preview: read it again and show it, so nothing unseen is saved.
        try {
          const fresh = await preview.mutateAsync(file.base64);
          setStep({ name: 'preview', preview: fresh, changed: true });
        } catch (again) {
          setError(failure(again));
        }
        return;
      }
      setError(failure(caught));
    }
  }

  const issueText = (issue: MemberImportIssue) => {
    const code = (ISSUE_CODES as readonly string[]).includes(issue.code)
      ? (issue.code as IssueCode)
      : null;
    const message = code
      ? t(`issues.${code}`, { at: issue.at ?? 0, value: issue.value ?? '' })
      : t('issues.other');
    const field = (FIELD_LABELS as readonly string[]).includes(issue.field)
      ? t(`fields.${issue.field as FieldLabel}`)
      : issue.field;
    return `${field}: ${message}`;
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step.name === 'done' ? t('done.title') : t('title')}</DialogTitle>
          <DialogDescription>
            {intoCommittee
              ? t('committeeDescription', { committee: committee?.name ?? '' })
              : t('description')}
          </DialogDescription>
        </DialogHeader>

        {step.name === 'file' ? (
          <div className="grid gap-4">
            {intoCommittee && committees.length > 1 ? (
              <div className="grid gap-1.5">
                <Label id="import-committee-label">{t('committee')}</Label>
                <Select value={committeeId} onValueChange={setCommitteeId}>
                  <SelectTrigger aria-labelledby="import-committee-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {committees.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {committeeLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {clubs.length > 1 ? (
              <div className="grid gap-1.5">
                <Label id="import-club-label">{t('club')}</Label>
                <Select value={clubId} onValueChange={setClubId}>
                  <SelectTrigger aria-labelledby="import-club-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clubs.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid gap-2 rounded-md bg-surface-3 p-3 text-sm text-fg-muted">
              <p className="m-0">{intoCommittee ? t('committeeColumnsHint') : t('columnsHint')}</p>
              <p className="m-0">
                {t('encodingHint', {
                  size: `${MEMBER_IMPORT_MAX_BYTES / 1_000_000} م.ب`,
                  rows: MEMBER_IMPORT_MAX_ROWS,
                })}
              </p>
              <a
                // The file comes straight from the API (text/csv), not through the JSON client.
                href={templateHref}
                download
                className="flex w-fit items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
              >
                <Download className="size-4" aria-hidden />
                {t('template')}
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label={t('chooseFile')}
                onChange={(event) => void pick(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                loading={reading}
              >
                <Upload aria-hidden />
                {file ? t('changeFile') : t('chooseFile')}
              </Button>
              {file ? (
                <span className="flex items-center gap-2 text-sm">
                  <FileSpreadsheet className="size-4 text-primary" aria-hidden />
                  <bdi dir="ltr" className="font-medium">
                    {file.name}
                  </bdi>
                  <span className="text-fg-muted">
                    {t('fileSize', {
                      kb: format.number(Math.max(1, Math.round(file.bytes / 1000)), 'integer'),
                    })}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {step.name === 'preview' ? (
          <PreviewStep
            preview={step.preview}
            changed={step.changed}
            onlyProblems={onlyProblems}
            onOnlyProblems={setOnlyProblems}
            issueText={issueText}
          />
        ) : null}

        {step.name === 'done' ? (
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            <li className="font-semibold text-success">
              {t('done.added', { count: step.result.added })}
            </li>
            <li>{t('done.restored', { count: step.result.restored })}</li>
            <li>{t('done.joined', { count: step.result.joined })}</li>
            <li className="text-fg-muted">
              {t('done.skippedExisting', { count: step.result.skippedExisting })}
            </li>
            <li className="text-fg-muted">
              {t('done.skippedInvalid', { count: step.result.skippedInvalid })}
            </li>
          </ul>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {step.name === 'file' ? (
            <Button
              type="button"
              onClick={() => void runPreview()}
              disabled={!file || reading}
              loading={preview.isPending}
            >
              {t('preview')}
            </Button>
          ) : null}
          {step.name === 'preview' ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStep({ name: 'file' });
                  setError(null);
                }}
              >
                {t('changeFile')}
              </Button>
              <Button
                type="button"
                disabled={writtenRows(step.preview) === 0}
                loading={confirm.isPending || preview.isPending}
                onClick={() => void runConfirm(step.preview)}
              >
                {writtenRows(step.preview) === 0
                  ? t('nothingToImport')
                  : t('confirm', { count: writtenRows(step.preview) })}
              </Button>
            </>
          ) : null}
          {step.name === 'done' ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('done.close')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The rows the import would write something for: everyone but the skipped. */
function writtenRows({ summary }: PreviewMemberImportResponse): number {
  return summary.add + summary.restore + summary.join;
}

function PreviewStep({
  preview,
  changed,
  onlyProblems,
  onOnlyProblems,
  issueText,
}: {
  preview: PreviewMemberImportResponse;
  changed: boolean;
  onlyProblems: boolean;
  onOnlyProblems: (value: boolean) => void;
  issueText: (issue: MemberImportIssue) => string;
}) {
  const t = useTranslations('members.import');
  const { summary } = preview;
  const rows = onlyProblems
    ? preview.rows.filter((row) => row.issues.length > 0 || row.warnings.length > 0)
    : preview.rows;

  return (
    <div className="grid gap-3">
      {changed ? (
        <p
          role="status"
          className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg"
        >
          {t('changed')}
        </p>
      ) : null}
      <ul
        aria-label={t('summary.label')}
        className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5"
      >
        {(['add', 'restore', 'join', 'existing', 'invalid'] as const).map((key) => (
          <li key={key} className="grid gap-0.5 rounded-md border border-border bg-surface-1 p-3">
            <span className="text-xs text-fg-muted">{t(`summary.${key}`)}</span>
            <span
              data-testid={`import-summary-${key}`}
              className="font-mono text-xl font-bold [direction:ltr]"
            >
              {summary[key]}
            </span>
          </li>
        ))}
      </ul>
      {preview.notices.map((notice) => (
        <p
          key={notice}
          role="note"
          className="m-0 rounded-md bg-info-subtle px-3 py-2 text-sm text-info-subtle-fg"
        >
          {t(`notices.${notice}`)}
        </p>
      ))}
      {preview.ignoredColumns.length > 0 ? (
        <p className="m-0 text-xs text-fg-muted">
          {t('ignoredColumns', { names: preview.ignoredColumns.join('، ') })}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Switch id="import-only-problems" checked={onlyProblems} onCheckedChange={onOnlyProblems} />
        <Label htmlFor="import-only-problems" className="text-sm">
          {t('rows.onlyProblems')}
        </Label>
      </div>

      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <Table aria-label={t('rows.label')} className="min-w-[36rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-px">{t('rows.line')}</TableHead>
              <TableHead>{t('rows.name')}</TableHead>
              <TableHead>{t('rows.email')}</TableHead>
              <TableHead>{t('rows.status')}</TableHead>
              <TableHead>{t('rows.details')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-fg-muted">
                  {t('rows.none')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => <PreviewRow key={row.line} row={row} issueText={issueText} />)
            )}
          </TableBody>
        </Table>
      </div>
      <p className="m-0 text-xs text-fg-muted">{t('notes')}</p>
    </div>
  );
}

function PreviewRow({
  row,
  issueText,
}: {
  row: MemberImportRow;
  issueText: (issue: MemberImportIssue) => string;
}) {
  const t = useTranslations('members.import');
  return (
    <TableRow>
      <TableCell className="font-mono text-fg-muted [direction:ltr]">{row.line}</TableCell>
      <TableCell className="font-medium">{row.fullName ?? '—'}</TableCell>
      <TableCell>
        {row.uniEmail ? (
          <bdi dir="ltr" className="text-xs">
            {row.uniEmail}
          </bdi>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
      </TableCell>
      <TableCell className="text-xs">
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {row.joinCommittees?.length ? (
            <li>{t('joinCommittees', { names: row.joinCommittees.join('، ') })}</li>
          ) : null}
          {row.issues.map((issue) => (
            <li key={`${issue.field}:${issue.code}:${issue.value ?? ''}`} className="text-danger">
              {issueText(issue)}
            </li>
          ))}
          {row.warnings.map((issue) => (
            <li key={`w:${issue.field}:${issue.code}`} className="text-warning">
              {issueText(issue)}
            </li>
          ))}
        </ul>
      </TableCell>
    </TableRow>
  );
}
