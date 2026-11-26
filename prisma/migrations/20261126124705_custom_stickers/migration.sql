-- CreateEnum
CREATE TYPE "StickerAwardBy" AS ENUM ('LEAD', 'OFFICER');

-- AlterTable
ALTER TABLE "BadgeAward" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "CustomSticker" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "howTo" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "ink" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "awardableBy" "StickerAwardBy" NOT NULL DEFAULT 'LEAD',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CustomSticker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomSticker_clubId_idx" ON "CustomSticker"("clubId");

-- AddForeignKey
ALTER TABLE "CustomSticker" ADD CONSTRAINT "CustomSticker_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomSticker" ADD CONSTRAINT "CustomSticker_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bounds the contract also enforces: a database that is written to by anything else still refuses
-- an award reason that is not a short line, and a sticker with an empty or enormous text.
ALTER TABLE "BadgeAward"
  ADD CONSTRAINT "BadgeAward_reason_check"
  CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 120);

ALTER TABLE "CustomSticker"
  ADD CONSTRAINT "CustomSticker_text_check"
  CHECK (
    char_length("name") BETWEEN 1 AND 40
    AND char_length("howTo") BETWEEN 1 AND 240
    AND char_length("label") BETWEEN 1 AND 14
    AND "background" ~ '^[a-z]{3,12}$'
    AND "ink" ~ '^[a-z]{3,12}$'
  );
