import { defineRoute } from '@/server/http';
import { resendCommitteeInvitation } from '@/server/modules/permissions';
import { resendCommitteeInvitationEndpoint } from '@/shared/contracts/permissions';

export const POST = defineRoute(resendCommitteeInvitationEndpoint, ({ actor, params }) =>
  resendCommitteeInvitation(actor, params.memberId, params.committeeId),
);
