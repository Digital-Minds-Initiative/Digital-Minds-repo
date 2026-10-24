-- CreateEnum
CREATE TYPE "DeletionKind" AS ENUM ('CLUB', 'COMMITTEE', 'PERSON');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "uniEmail" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DeletionRecord" (
    "id" UUID NOT NULL,
    "kind" "DeletionKind" NOT NULL,
    "targetId" UUID NOT NULL,
    "clubId" UUID,
    "deletedById" UUID NOT NULL,
    "counts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletionRecord_createdAt_idx" ON "DeletionRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "DeletionRecord" ADD CONSTRAINT "DeletionRecord_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written CHECK constraints (Prisma does not model them).
-- A person is either live, with a university email, or deleted (docs/adr/0026-person-deletion.md):
-- no email, and nothing left that names them or grants them anything.
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_check"
  CHECK (
    ("deletedAt" IS NULL AND "uniEmail" IS NOT NULL)
    OR (
      "deletedAt" IS NOT NULL
      AND "uniEmail" IS NULL
      AND "fullName" = ''
      AND "searchName" = ''
      AND NOT "isFullAdmin"
      AND "registeredAt" IS NULL
    )
  );

-- Only a committee delete names a club beside its target.
ALTER TABLE "DeletionRecord" ADD CONSTRAINT "DeletionRecord_clubId_check"
  CHECK (("kind" = 'COMMITTEE') = ("clubId" IS NOT NULL));

-- Counts per table, never a list of rows or anything else.
ALTER TABLE "DeletionRecord" ADD CONSTRAINT "DeletionRecord_counts_check"
  CHECK (jsonb_typeof("counts") = 'object');
