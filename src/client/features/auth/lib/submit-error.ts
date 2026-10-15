import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

import { ApiError } from '@/client/lib/api-client';
import type { ErrorCode } from '@/shared/contracts/core';

import { applyFieldIssues, otpDialogKind } from './api-issues';
import type { AuthErrorKind } from '../components/auth-error-dialog';

export interface AuthDialogState {
  kind: AuthErrorKind;
  retryAfterSeconds?: number;
}

/**
 * Routes a failed request to where the user should see it: a dialog (wrong/expired code, too many
 * requests), a field (server validation issue), or — returned — a message for the whole form.
 */
export function routeSubmitError<T extends FieldValues>(
  error: unknown,
  options: {
    setError: UseFormSetError<T>;
    fields: readonly FieldPath<T>[];
    onDialog: (dialog: AuthDialogState) => void;
  },
): ErrorCode | 'NETWORK' | null {
  if (!(error instanceof ApiError)) return 'INTERNAL';
  const kind = otpDialogKind(error);
  if (kind) {
    options.onDialog({ kind, retryAfterSeconds: error.details.retryAfterSeconds });
    return null;
  }
  if (applyFieldIssues(error, options.setError, options.fields)) return null;
  return error.code;
}
