-- CreateEnum
CREATE TYPE "ClubRole" AS ENUM ('MEMBER', 'CLUB_OFFICER');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
CREATE TYPE "PointTransactionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PointRevisionAction" AS ENUM ('UPDATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "searchName" TEXT NOT NULL,
    "uniEmail" TEXT NOT NULL,
    "personalEmail" TEXT,
    "phone" TEXT,
    "college" TEXT,
    "major" TEXT,
    "level" SMALLINT,
    "isFullAdmin" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Committee" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "viewToken" TEXT,
    "viewTokenRotatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Committee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipType" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" SMALLINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "membershipTypeId" UUID NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeMembership" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "committeeId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "role" "CommitteeRole" NOT NULL DEFAULT 'MEMBER',
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" UUID NOT NULL,
    "committeeMembershipId" UUID NOT NULL,
    "committeeId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "status" "PointTransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "batchId" UUID,
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransactionRevision" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "action" "PointRevisionAction" NOT NULL,
    "previousAmount" INTEGER NOT NULL,
    "previousReason" TEXT NOT NULL,
    "previousWorkDate" DATE NOT NULL,
    "previousStatus" "PointTransactionStatus" NOT NULL,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransactionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_uniEmail_key" ON "User"("uniEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Committee_viewToken_key" ON "Committee"("viewToken");

-- CreateIndex
CREATE UNIQUE INDEX "Committee_clubId_name_key" ON "Committee"("clubId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Committee_id_clubId_key" ON "Committee"("id", "clubId");

-- CreateIndex
CREATE INDEX "MembershipType_clubId_order_idx" ON "MembershipType"("clubId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipType_clubId_name_key" ON "MembershipType"("clubId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipType_id_clubId_key" ON "MembershipType"("id", "clubId");

-- CreateIndex
CREATE INDEX "Membership_clubId_removedAt_idx" ON "Membership"("clubId", "removedAt");

-- CreateIndex
CREATE INDEX "Membership_membershipTypeId_idx" ON "Membership"("membershipTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_clubId_key" ON "Membership"("userId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_clubId_key" ON "Membership"("id", "clubId");

-- CreateIndex
CREATE INDEX "CommitteeMembership_committeeId_removedAt_idx" ON "CommitteeMembership"("committeeId", "removedAt");

-- CreateIndex
CREATE INDEX "CommitteeMembership_clubId_idx" ON "CommitteeMembership"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeMembership_membershipId_committeeId_key" ON "CommitteeMembership"("membershipId", "committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeMembership_id_committeeId_clubId_key" ON "CommitteeMembership"("id", "committeeId", "clubId");

-- CreateIndex
CREATE INDEX "PointTransaction_committeeMembershipId_status_workDate_idx" ON "PointTransaction"("committeeMembershipId", "status", "workDate");

-- CreateIndex
CREATE INDEX "PointTransaction_committeeId_status_workDate_idx" ON "PointTransaction"("committeeId", "status", "workDate");

-- CreateIndex
CREATE INDEX "PointTransaction_clubId_status_workDate_idx" ON "PointTransaction"("clubId", "status", "workDate");

-- CreateIndex
CREATE INDEX "PointTransaction_batchId_idx" ON "PointTransaction"("batchId");

-- CreateIndex
CREATE INDEX "PointTransactionRevision_transactionId_createdAt_idx" ON "PointTransactionRevision"("transactionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_membershipTypeId_clubId_fkey" FOREIGN KEY ("membershipTypeId", "clubId") REFERENCES "MembershipType"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembership" ADD CONSTRAINT "CommitteeMembership_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembership" ADD CONSTRAINT "CommitteeMembership_committeeId_clubId_fkey" FOREIGN KEY ("committeeId", "clubId") REFERENCES "Committee"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_committeeMembershipId_committeeId_clubId_fkey" FOREIGN KEY ("committeeMembershipId", "committeeId", "clubId") REFERENCES "CommitteeMembership"("id", "committeeId", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransactionRevision" ADD CONSTRAINT "PointTransactionRevision_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PointTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransactionRevision" ADD CONSTRAINT "PointTransactionRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written integrity constraints (not modelled by Prisma, never dropped by it).
-- They back up rules the application already enforces, so a bug or a manual SQL
-- edit cannot store data that breaks them. See docs/adr/0003-data-model.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- The university email is the identity key used to link registration to pre-created data.
ALTER TABLE "User" ADD CONSTRAINT "User_uniEmail_lowercase_check"
  CHECK ("uniEmail" = lower("uniEmail"));

ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_order_check"
  CHECK ("order" >= 0);

-- A zero-point transaction is meaningless; deductions are negative amounts.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_amount_nonzero_check"
  CHECK ("amount" <> 0);

ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_reason_not_blank_check"
  CHECK (btrim("reason") <> '');

-- Cancellation metadata is present exactly when the transaction is cancelled.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_cancellation_consistent_check"
  CHECK (
    ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL)
  );
