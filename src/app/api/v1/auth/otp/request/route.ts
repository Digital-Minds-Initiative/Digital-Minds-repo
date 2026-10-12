import { defineRoute } from '@/server/http';
import { requestOtp } from '@/server/modules/auth';
import { requestOtpEndpoint } from '@/shared/contracts/auth';

export const POST = defineRoute(requestOtpEndpoint, ({ body, client }) => requestOtp(body, client));
