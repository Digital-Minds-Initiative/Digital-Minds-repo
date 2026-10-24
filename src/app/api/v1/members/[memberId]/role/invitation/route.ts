import { defineRoute } from '@/server/http';
import { resendClubInvitation } from '@/server/modules/permissions';
import { resendClubInvitationEndpoint } from '@/shared/contracts/permissions';

export const POST = defineRoute(resendClubInvitationEndpoint, ({ actor, params }) =>
  resendClubInvitation(actor, params.memberId),
);
