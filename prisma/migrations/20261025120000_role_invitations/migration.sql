-- CreateTable
CREATE TABLE "RoleInvitation" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "committeeId" UUID,
    "membershipId" UUID NOT NULL,
    "sentById" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleInvitation_membershipId_sentAt_idx" ON "RoleInvitation"("membershipId", "sentAt");

-- CreateIndex
CREATE INDEX "RoleInvitation_committeeId_idx" ON "RoleInvitation"("committeeId");

-- AddForeignKey
ALTER TABLE "RoleInvitation" ADD CONSTRAINT "RoleInvitation_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInvitation" ADD CONSTRAINT "RoleInvitation_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInvitation" ADD CONSTRAINT "RoleInvitation_committeeId_clubId_fkey" FOREIGN KEY ("committeeId", "clubId") REFERENCES "Committee"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInvitation" ADD CONSTRAINT "RoleInvitation_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

