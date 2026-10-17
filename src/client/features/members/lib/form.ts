import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

export interface FormIssue {
  path: ReadonlyArray<PropertyKey>;
  code: string;
  message: string;
}

/**
 * Puts validation issues — from a contract schema run in the browser, or from a 422 — on the
 * fields they are about, found by the last segment of the issue's path (`person.uniEmail` →
 * `uniEmail`). A custom rule's message is its key (`invalid_phone`), the same convention the
 * contracts and `FormField` share. Returns whether any issue landed on a field.
 */
export function applyIssues<T extends FieldValues>(
  form: UseFormReturn<T>,
  issues: readonly FormIssue[],
  fields: readonly Path<T>[],
): boolean {
  let applied = false;
  for (const issue of issues) {
    const last = String(issue.path.at(-1));
    const field = fields.find((candidate) => candidate === last);
    if (!field) continue;
    const key = issue.code === 'custom' ? issue.message : issue.code;
    form.setError(field, { type: key, message: key });
    applied = true;
  }
  return applied;
}

/** An empty or whitespace-only text box means "not filled in". */
export function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
