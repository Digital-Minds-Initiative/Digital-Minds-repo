-- CreateEnum
CREATE TYPE "MembershipTypeChangeKind" AS ENUM ('TYPE_CREATED', 'TYPE_RENAMED', 'TYPE_DELETED', 'MEMBER_TYPE_CHANGED');

-- CreateEnum
CREATE TYPE "MemberTypeChangeSource" AS ENUM ('EDIT', 'RESTORE', 'TYPE_DELETED');

-- CreateTable
CREATE TABLE "MembershipTypeChange" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "kind" "MembershipTypeChangeKind" NOT NULL,
    "membershipId" UUID,
    "source" "MemberTypeChangeSource",
    "previousName" TEXT,
    "newName" TEXT,
    "movedMembers" INTEGER,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipTypeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipTypeChange_clubId_createdAt_idx" ON "MembershipTypeChange"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipTypeChange_membershipId_createdAt_idx" ON "MembershipTypeChange"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma does not model them).
-- docs/adr/0031-membership-type-history.md. One table holds four kinds of row; these keep each
-- kind's columns exactly as the history reads them.

-- A membership and how it changed belong to member rows, and only to them.
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_member_columns_check"
  CHECK (
    ("kind" = 'MEMBER_TYPE_CHANGED') = ("membershipId" IS NOT NULL)
    AND ("kind" = 'MEMBER_TYPE_CHANGED') = ("source" IS NOT NULL)
  );

-- The moved count belongs to a deleted type, and only to it.
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_moved_members_check"
  CHECK (
    ("kind" = 'TYPE_DELETED') = ("movedMembers" IS NOT NULL)
    AND ("movedMembers" IS NULL OR "movedMembers" >= 0)
  );

-- Which names each kind carries. A deleted type names where its members went exactly when it
-- had members to move. A row records a change, so a before and an after are never the same.
ALTER TABLE "MembershipTypeChange" ADD CONSTRAINT "MembershipTypeChange_names_check"
  CHECK (
    CASE "kind"
      WHEN 'TYPE_CREATED' THEN "previousName" IS NULL AND "newName" IS NOT NULL
      WHEN 'TYPE_DELETED' THEN "previousName" IS NOT NULL
        AND ("newName" IS NOT NULL) = ("movedMembers" > 0)
      ELSE "previousName" IS NOT NULL AND "newName" IS NOT NULL
    END
    AND ("previousName" IS NULL OR "newName" IS NULL OR "previousName" <> "newName")
  );
