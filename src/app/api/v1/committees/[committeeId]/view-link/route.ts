import { defineRoute } from '@/server/http';
import {
  disableCommitteeViewLink,
  getCommitteeViewLink,
  rotateCommitteeViewLink,
} from '@/server/modules/clubs';
import {
  disableCommitteeViewLinkEndpoint,
  getCommitteeViewLinkEndpoint,
  rotateCommitteeViewLinkEndpoint,
} from '@/shared/contracts/clubs';

export const GET = defineRoute(getCommitteeViewLinkEndpoint, ({ actor, params }) =>
  getCommitteeViewLink(actor, params.committeeId),
);

export const POST = defineRoute(rotateCommitteeViewLinkEndpoint, ({ actor, params }) =>
  rotateCommitteeViewLink(actor, params.committeeId),
);

export const DELETE = defineRoute(disableCommitteeViewLinkEndpoint, ({ actor, params }) =>
  disableCommitteeViewLink(actor, params.committeeId),
);
