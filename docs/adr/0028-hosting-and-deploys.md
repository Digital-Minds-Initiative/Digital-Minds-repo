# 0028. Vercel and Neon in Frankfurt, deployed only from GitHub Actions

- Status: Accepted
- Date: 2026-10-24

## Context

Nothing in the code assumed a host. The app is one Next.js server with PostgreSQL, so it needs a platform that runs Next.js 16 (including `after()`, which invite-only sign-in depends on — ADR 0027) and a managed Postgres 18 close to it. Users are in Saudi Arabia; the nearest region both Vercel and Neon offer is Frankfurt.

There are three environments: local (Docker, as before), dev (`develop`, dev.digitalmindsint.org, demo data) and production (`main`, digitalmindsint.org, real data). Feature PRs go to `develop`; a release PR takes `develop` to `main`.

The constraints that shaped the decision:

- The Vercel account is one person's Hobby account, and the repository belongs to a GitHub organization. Hobby's Git integration does not deploy private organization repositories and only deploys commits authored by the account owner, and teammates merge most PRs.
- Hobby has no custom environments, so dev cannot be a third Vercel environment.
- The GitHub organization is on the Free plan. For a private repository that means no branch protection, no environment secrets and no required reviewers. The repository is being made public, which turns all three on for free. That makes a history check part of the launch.
- Neon's free plan keeps six hours of history, which is too short to undo a mistake noticed the next day.

## Decision

**Hosting.** Vercel functions in `fra1` (`vercel.json`), Neon Postgres 18 in AWS Europe Central 1. Each Neon branch is one environment: `production` (default) and `dev`.

**Deploys come only from GitHub Actions.** `vercel.json` turns Git-triggered deployments off. `.github/workflows/deploy.yml` runs on a push to `develop` or `main`, in this order:

1. CI (it calls `ci.yml`, so a deploy waits for every check on that same commit);
2. `vercel pull`, then `vercel build`;
3. `prisma migrate deploy`, then `scripts/sql/app-role.sql`;
4. `vercel deploy --prebuilt`, plus `vercel alias set … dev.digitalmindsint.org` for `develop`.

The build comes first, so a commit that does not build never touches the database, and a failed migration stops the job before the deploy. Dev is a Vercel **Preview** deployment that the alias points the dev domain at. Production deploys take the production domains automatically.

**Secrets live in GitHub Environments.** `dev` and `production` each hold their own `VERCEL_TOKEN` and their branch's `DIRECT_URL`, and accept only their own branch. Production needs a reviewer's approval. A third environment, `backup`, holds only production's read-only backup URL and the backup passphrase, so the daily schedule needs no approval and never holds the owner role. Pushes from forks never run the deploy, and `pull_request` runs get no secrets.

**Database roles.** The app connects through Neon's pooler (PgBouncer, transaction mode) as `digital_minds_app`, which may read and write rows and nothing else. Migrations, the seed and `admin:grant` use the owner role through the direct address (`DIRECT_URL`, read by `prisma.config.ts` and the scripts, never by the app). Backups use `digital_minds_backup`, which may only read. The grants are `scripts/sql/app-role.sql`, idempotent, re-applied after every migration.

**What differs between dev and production comes from env variables, never from `NODE_ENV`.** `NODE_ENV=production` in both, so both are held to the production checks in `src/server/env.ts`.

**A hosted database says which environment it is.** `ALTER DATABASE digital_minds SET app.environment = 'dev' | 'production'` is run once per branch. The seed and the bulk measurement refuse any non-local database that does not answer `dev`, and the seed also needs `ALLOW_SEED=true`. A production URL pasted by mistake is then refused without the repository knowing any production host, and a branch copied from production inherits the refusal.

**Backups.** `.github/workflows/backup.yml` runs once a day. It streams `pg_dump` into `gpg --symmetric` (AES-256) and keeps the file as a workflow artifact for 30 days. Restores go into a new Neon branch first (`scripts/db-restore.sh`).

## Consequences

- Nothing here needs Vercel Pro. Hobby's limits that matter: non-commercial use only, one account, and instant rollback only to the previous production deployment (older ones through `vercel promote`).
- **Release PRs (`develop` → `main`) use a merge commit, never squash.** A squash would leave `main` with commits `develop` does not have, and every later release would conflict. Feature PRs into `develop` are still squash-merged. A hotfix branches from `main`, merges into `main`, and `main` is then merged back into `develop`.
- A migration is applied before its code goes live, and stays applied if the deploy step after it fails. Migrations must therefore be **backward compatible with the running code**: add first, remove in a later release (expand, then contract).
- The pooler is safe for our code because everything that must share a connection runs inside one `$transaction`: the `FOR UPDATE` locks and the conditional updates. Single-statement `$queryRaw` calls need no session state. Code that needs session state (advisory locks, `SET` outside a transaction, `LISTEN`) would not work through it.
- `src/server/db/client.ts` hands its `pg.Pool` to Vercel's `attachDatabasePool`, so a suspended Fluid-compute instance closes its idle connections instead of leaking them. It does nothing anywhere else.
- The client IP for rate limits is `x-real-ip`, which Vercel overwrites with the connecting address (`CLIENT_IP_HEADER`).
- Vercel caps request bodies at 4.5 MB, above the app's own 2 MB.
- Dev sends real email but holds demo data, so `EMAIL_ALLOWLIST` limits it to the testers' addresses; every other send is skipped invisibly. A production deployment (`VERCEL_ENV=production`) refuses to start with it set. The demo dataset's university addresses are patterns no person has (`s000000001@st.uqu.edu.sa`, `demo-staff-01@uqu.edu.sa`).
- The repository is public, so the workflow logs and backup artifacts are readable by anyone. The workflows print no secret (GitHub also masks them). `prisma migrate deploy` does print the database host, which is not a credential. A backup's only protection is its passphrase; an off-GitHub bucket is the better long-term place for them.
