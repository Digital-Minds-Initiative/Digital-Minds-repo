-- CreateEnum
CREATE TYPE "CardTone" AS ENUM ('PAPER', 'MATTE');

-- CreateTable
CREATE TABLE "MemberCard" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "tone" "CardTone",
    "shareEnabled" BOOLEAN NOT NULL DEFAULT true,
    "showPoints" BOOLEAN NOT NULL DEFAULT true,
    "showActivity" BOOLEAN NOT NULL DEFAULT false,
    "shareTokenHash" TEXT NOT NULL,
    "shareTokenCipher" BYTEA NOT NULL,
    "shareTokenCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeAward" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "awardedById" UUID NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgePlacement" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL,
    "scale" DOUBLE PRECISION NOT NULL,
    "z" INTEGER NOT NULL,

    CONSTRAINT "BadgePlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberCard_membershipId_key" ON "MemberCard"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCard_shareTokenHash_key" ON "MemberCard"("shareTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCard_membershipId_clubId_key" ON "MemberCard"("membershipId", "clubId");

-- CreateIndex
CREATE INDEX "BadgeAward_clubId_idx" ON "BadgeAward"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeAward_membershipId_badgeKey_key" ON "BadgeAward"("membershipId", "badgeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BadgePlacement_cardId_badgeKey_key" ON "BadgePlacement"("cardId", "badgeKey");

-- AddForeignKey
ALTER TABLE "MemberCard" ADD CONSTRAINT "MemberCard_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_membershipId_clubId_fkey" FOREIGN KEY ("membershipId", "clubId") REFERENCES "Membership"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgePlacement" ADD CONSTRAINT "BadgePlacement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "MemberCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A sticker's layout is a fraction of the card and a small turn and size: the database refuses
-- anything that would put a sticker off the card or make it enormous or invisible.
ALTER TABLE "BadgePlacement"
  ADD CONSTRAINT "BadgePlacement_layout_check"
  CHECK ("x" BETWEEN 0 AND 1 AND "y" BETWEEN 0 AND 1 AND "rotation" BETWEEN -60 AND 60 AND "scale" BETWEEN 0.4 AND 2.5 AND "z" BETWEEN 0 AND 100);
