-- CreateEnum
CREATE TYPE "GrantableRole" AS ENUM ('MEMBER', 'CLUB_OFFICER', 'LEAD');

-- CreateTable
CREATE TABLE "RoleChange" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "committeeId" UUID,
    "membershipId" UUID NOT NULL,
    "changedById" UUID NOT NULL,
    "previousRole" "GrantableRole" NOT NULL,
    "newRole" "GrantableRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleChange_clubId_createdAt_idx" ON "RoleChange"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "RoleChange_membershipId_createdAt_idx" ON "RoleChange"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_committeeId_clubId_fkey" FOREIGN KEY ("committeeId", "clubId") REFERENCES "Committee"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma does not model them).
-- One table records both kinds of role change, so the pair of roles must match the target:
-- a club-level row (no committee) is about CLUB_OFFICER, a committee row about LEAD. MEMBER is
-- the absence of a role and is valid on both sides of either kind.
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_roles_match_target_check"
  CHECK (
    (
      "committeeId" IS NULL
      AND "previousRole" <> 'LEAD'
      AND "newRole" <> 'LEAD'
    )
    OR (
      "committeeId" IS NOT NULL
      AND "previousRole" <> 'CLUB_OFFICER'
      AND "newRole" <> 'CLUB_OFFICER'
    )
  );

-- A row records a change, so the two roles are never the same (a no-op writes no row).
ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_roles_differ_check"
  CHECK ("previousRole" <> "newRole");
