-- The public view link's token is no longer stored as it is sent (docs/adr/0023-committee-view-link.md):
-- the lookup key is an HMAC keyed with AUTH_SECRET, and the copy that lets an officer see the link
-- again is encrypted with the same secret, so a database leak alone hands out no working link.
-- No link had been issued yet, so there is nothing to migrate.

-- DropIndex
DROP INDEX "Committee_viewToken_key";

-- AlterTable
ALTER TABLE "Committee" DROP COLUMN "viewToken",
DROP COLUMN "viewTokenRotatedAt",
ADD COLUMN     "viewTokenCipher" BYTEA,
ADD COLUMN     "viewTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "viewTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Committee_viewTokenHash_key" ON "Committee"("viewTokenHash");

-- Hand-written CHECK constraints (Prisma does not model them).
-- A link is all three columns or none of them: a hash without its encrypted copy could never be
-- shown again, and a copy without a hash could never be found.
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_view_token_complete_check"
  CHECK (
    ("viewTokenHash" IS NULL) = ("viewTokenCipher" IS NULL)
    AND ("viewTokenHash" IS NULL) = ("viewTokenCreatedAt" IS NULL)
  );

-- The lookup key is an HMAC-SHA256 in lower-case hex.
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_view_token_hash_format_check"
  CHECK ("viewTokenHash" IS NULL OR "viewTokenHash" ~ '^[0-9a-f]{64}$');
