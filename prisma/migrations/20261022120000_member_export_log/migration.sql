-- CreateEnum
CREATE TYPE "MemberExportSelection" AS ENUM ('ALL', 'IDS');

-- CreateTable
CREATE TABLE "MemberExport" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "exportedById" UUID NOT NULL,
    "selection" "MemberExportSelection" NOT NULL,
    "selectedCount" INTEGER,
    "filters" JSONB NOT NULL,
    "columns" TEXT[],
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberExport_clubId_createdAt_idx" ON "MemberExport"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberExport_exportedById_createdAt_idx" ON "MemberExport"("exportedById", "createdAt");

-- AddForeignKey
ALTER TABLE "MemberExport" ADD CONSTRAINT "MemberExport_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberExport" ADD CONSTRAINT "MemberExport_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written CHECK constraints (Prisma does not model them).
-- A file holds at most 5000 members (MEMBER_EXPORT_MAX_ROWS in src/shared/contracts/members-export.ts).
ALTER TABLE "MemberExport" ADD CONSTRAINT "MemberExport_rowCount_check"
  CHECK ("rowCount" BETWEEN 0 AND 5000);

-- Ticked members are counted, and every one of them is in the file or nothing is exported, so
-- the count is set exactly for IDS and always equals the rows written.
ALTER TABLE "MemberExport" ADD CONSTRAINT "MemberExport_selectedCount_check"
  CHECK (
    ("selection" = 'IDS' AND "selectedCount" IS NOT NULL AND "selectedCount" = "rowCount")
    OR ("selection" = 'ALL' AND "selectedCount" IS NULL)
  );

-- A file has at least one column.
ALTER TABLE "MemberExport" ADD CONSTRAINT "MemberExport_columns_check"
  CHECK ("columns" IS NOT NULL AND cardinality("columns") >= 1);
