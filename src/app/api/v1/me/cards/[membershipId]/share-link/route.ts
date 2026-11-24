import { defineRoute } from '@/server/http';
import { renewCardLink } from '@/server/modules/wallet';
import { renewCardLinkEndpoint } from '@/shared/contracts/cards';

export const POST = defineRoute(renewCardLinkEndpoint, ({ actor, params }) =>
  renewCardLink(actor, params.membershipId),
);
