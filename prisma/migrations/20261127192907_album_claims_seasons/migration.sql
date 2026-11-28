-- CreateEnum
CREATE TYPE "StickerRarity" AS ENUM ('COMMON', 'RARE', 'LEGENDARY');

-- AlterTable
ALTER TABLE "CustomSticker" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "availableUntil" TIMESTAMP(3),
ADD COLUMN     "maxHolders" INTEGER,
ADD COLUMN     "rarity" "StickerRarity" NOT NULL DEFAULT 'COMMON';

-- CreateTable
CREATE TABLE "StickerClaim" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "committeeId" UUID,
    "badgeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "maxClaims" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerClaimRedemption" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerClaimRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerClaim_clubId_idx" ON "StickerClaim"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "StickerClaimRedemption_claimId_membershipId_key" ON "StickerClaimRedemption"("claimId", "membershipId");

-- AddForeignKey
ALTER TABLE "StickerClaim" ADD CONSTRAINT "StickerClaim_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerClaim" ADD CONSTRAINT "StickerClaim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerClaimRedemption" ADD CONSTRAINT "StickerClaimRedemption_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "StickerClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bounds the contract also enforces, so anything else that writes to these tables is held to them.
ALTER TABLE "CustomSticker"
  ADD CONSTRAINT "CustomSticker_season_check"
  CHECK (
    ("maxHolders" IS NULL OR "maxHolders" BETWEEN 1 AND 100000)
    AND ("availableFrom" IS NULL OR "availableUntil" IS NULL OR "availableFrom" < "availableUntil")
  );

ALTER TABLE "StickerClaim"
  ADD CONSTRAINT "StickerClaim_bounds_check"
  CHECK (
    "maxClaims" BETWEEN 1 AND 500
    AND char_length("title") BETWEEN 1 AND 60
    AND "expiresAt" <= "createdAt" + interval '25 hours'
  );
