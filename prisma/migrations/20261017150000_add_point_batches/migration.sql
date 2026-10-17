-- CreateTable
CREATE TABLE "PointBatch" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "committeeId" UUID,
    "requestHash" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointBatch_clubId_createdAt_idx" ON "PointBatch"("clubId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointBatch_id_clubId_key" ON "PointBatch"("id", "clubId");

-- Hand-written backfill, before the foreign key below can be trusted: batches recorded as a
-- shared `PointTransaction.batchId` predate this table (the demo seed writes them), and the
-- composite foreign key would refuse them. One row per existing batch, taking the committee
-- when every transaction in it shares one, who recorded the first of them, and when.
-- `requestHash` stays null: these batches were never an API request, so none can be replayed.
INSERT INTO "PointBatch" ("id", "clubId", "committeeId", "requestHash", "createdById", "createdAt")
SELECT
  batch."batchId",
  batch."clubId",
  CASE WHEN batch."committeeCount" = 1 THEN batch."oneCommitteeId" ELSE NULL END,
  NULL,
  first_row."createdById",
  batch."firstCreatedAt"
FROM (
  SELECT
    "batchId",
    "clubId",
    COUNT(DISTINCT "committeeId") AS "committeeCount",
    -- There is no min(uuid): compare as text, and only use it when there is one committee.
    MIN("committeeId"::text)::uuid AS "oneCommitteeId",
    MIN("createdAt") AS "firstCreatedAt"
  FROM "PointTransaction"
  WHERE "batchId" IS NOT NULL
  GROUP BY "batchId", "clubId"
) AS batch
JOIN LATERAL (
  SELECT transaction."createdById"
  FROM "PointTransaction" AS transaction
  WHERE transaction."batchId" = batch."batchId" AND transaction."clubId" = batch."clubId"
  ORDER BY transaction."createdAt", transaction."id"
  LIMIT 1
) AS first_row ON TRUE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_batchId_clubId_fkey" FOREIGN KEY ("batchId", "clubId") REFERENCES "PointBatch"("id", "clubId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointBatch" ADD CONSTRAINT "PointBatch_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointBatch" ADD CONSTRAINT "PointBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraint (Prisma does not model it).
-- The request hash is a SHA-256 in lower-case hex, or absent.
ALTER TABLE "PointBatch" ADD CONSTRAINT "PointBatch_request_hash_format_check"
  CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$');
