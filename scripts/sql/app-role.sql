-- What the app role and the backup role may do. Run as digital_minds_owner on each Neon branch.
--
-- Safe to run any number of times. The deploy workflow runs it after every `prisma migrate deploy`
-- (`prisma db execute --file scripts/sql/app-role.sql`), so a new table is covered in the same
-- deploy that creates it; run it by hand after a restore, whose dump carries no grants.
--
-- digital_minds_app     the running app (DATABASE_URL): read and write rows, nothing else — no DDL,
--                       no TRUNCATE, and no access to Prisma's migration history.
-- digital_minds_backup  the daily backup (BACKUP_DATABASE_URL): read everything, write nothing.
-- digital_minds_owner   migrations, the seed and admin:grant (DIRECT_URL), and nothing at runtime.
--
-- The roles themselves are created once per branch by hand (README, "Deploying"), because their
-- passwords must never be in this repository.

GRANT USAGE ON SCHEMA public TO digital_minds_app, digital_minds_backup;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO digital_minds_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO digital_minds_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO digital_minds_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO digital_minds_backup;

-- Tables the owner creates later (every migration) get the same rights without anyone remembering.
ALTER DEFAULT PRIVILEGES FOR ROLE digital_minds_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO digital_minds_app;
ALTER DEFAULT PRIVILEGES FOR ROLE digital_minds_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO digital_minds_app;
ALTER DEFAULT PRIVILEGES FOR ROLE digital_minds_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO digital_minds_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE digital_minds_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO digital_minds_backup;

-- The default privileges above also cover Prisma's own table; the app has no business in it.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM digital_minds_app;
  END IF;
END
$$;
