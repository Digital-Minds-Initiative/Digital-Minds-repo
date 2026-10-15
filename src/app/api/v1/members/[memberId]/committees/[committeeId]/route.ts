import { defineRoute } from '@/server/http';
import { addMemberToCommittee, removeMemberFromCommittee } from '@/server/modules/members';
import {
  addMemberToCommitteeEndpoint,
  removeMemberFromCommitteeEndpoint,
} from '@/shared/contracts/members';

export const PUT = defineRoute(addMemberToCommitteeEndpoint, ({ actor, params }) =>
  addMemberToCommittee(actor, params.memberId, params.committeeId),
);

export const DELETE = defineRoute(removeMemberFromCommitteeEndpoint, ({ actor, params }) =>
  removeMemberFromCommittee(actor, params.memberId, params.committeeId),
);
