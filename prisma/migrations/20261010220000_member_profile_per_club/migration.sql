-- Contact and study details move from the shared account (User) to each club's membership, so a
-- club never reads or overwrites what another club recorded. See docs/adr/0012-member-profiles-per-club.md.
-- Order matters: add the new columns, copy the data, then drop the old columns.

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "college" TEXT,
ADD COLUMN     "level" SMALLINT,
ADD COLUMN     "major" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "phone" TEXT;

-- Every existing membership (active or removed) starts with the values the account held, so no
-- data is lost. From here on each club's copy changes independently.
UPDATE "Membership" AS m
SET "personalEmail" = u."personalEmail",
    "phone" = u."phone",
    "college" = u."college",
    "major" = u."major",
    "level" = u."level"
FROM "User" AS u
WHERE u."id" = m."userId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "college",
DROP COLUMN "level",
DROP COLUMN "major",
DROP COLUMN "personalEmail",
DROP COLUMN "phone";
