import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

import type { AuthErrorKind } from '@/client/features/auth/components/auth-error-dialog';
import { type ApiError } from '@/client/lib/api-client';
import type { OtpRejection } from '@/shared/contracts/auth';

const otpRejections: readonly OtpRejection[] = [
  'invalid_code',
  'too_many_attempts',
  'code_expired',
];

function issueCode(error: ApiError, pathEnd: string): string | undefined {
  return error.details.issues?.find((issue) => issue.path.at(-1) === pathEnd)?.code;
}

export function applyFieldIssues<T extends FieldValues>(
  error: ApiError,
  setError: UseFormSetError<T>,
  fields: readonly FieldPath<T>[],
): boolean {
  let applied = false;
  for (const field of fields) {
    const code = issueCode(error, String(field));
    if (!code) continue;
    setError(field, { type: code, message: code });
    applied = true;
  }
  return applied;
}

export function otpDialogKind(error: ApiError): AuthErrorKind | null {
  if (error.code === 'RATE_LIMITED') return 'rate_limited';
  const code = issueCode(error, 'code');
  if (code && (otpRejections as readonly string[]).includes(code)) return code as AuthErrorKind;
  return null;
}
