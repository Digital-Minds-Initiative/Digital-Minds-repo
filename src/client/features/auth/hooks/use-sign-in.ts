'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/client/lib/api-client';
import { forgetPreviousPage } from '@/client/lib/navigation-history';
import { useRouter } from '@/i18n/navigation';
import {
  completeNameEndpoint,
  logoutEndpoint,
  requestOtpEndpoint,
  verifyOtpEndpoint,
} from '@/shared/contracts/auth';

import { meQueryKey } from './use-me';
import { sessionQueryKey } from './use-session';

/** Step 1: email a code. */
export function useRequestOtp() {
  return useMutation({
    mutationFn: (body: { email: string }) => apiClient.request(requestOtpEndpoint, { body }),
  });
}

/** Step 2: check the code. The answer says which step comes next. */
export function useVerifyOtp() {
  return useMutation({
    mutationFn: (body: { email: string; code: string }) =>
      apiClient.request(verifyOtpEndpoint, { body }),
  });
}

/** Step 3: confirm or enter the full name. */
export function useCompleteName() {
  return useMutation({
    mutationFn: (body: { fullName: string }) => apiClient.request(completeNameEndpoint, { body }),
  });
}

/** Forgets what the cache knows about the previous session so `/me` and the session are re-read. */
export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    void queryClient.resetQueries({ queryKey: meQueryKey });
  };
}

/** Ends the session, drops every cached answer and goes to the sign-in page. */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => apiClient.request(logoutEndpoint, {}),
    onSettled: () => {
      queryClient.clear();
      forgetPreviousPage();
      router.replace('/login');
    },
  });
}
