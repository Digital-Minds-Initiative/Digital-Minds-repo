import { defineRoute, withSession } from '@/server/http';
import { verifyOtp } from '@/server/modules/auth';
import { verifyOtpEndpoint } from '@/shared/contracts/auth';

export const POST = defineRoute(verifyOtpEndpoint, ({ body, client }) =>
  verifyOtp(body, client).then(withSession),
);
