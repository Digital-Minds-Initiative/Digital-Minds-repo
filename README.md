# Digital Minds

Digital Minds (العقول الرقمية) is the platform for the tech student clubs at Umm Al-Qura University. Clubs (نادي الحاسبات، نادي طويق، …) manage their members, committees and points in one place. The UI is Arabic and right-to-left.

**Phase one** covers the members & points module (الموارد) and a simple landing page:

- one account per person, identified by the university email; admins can add people before they register;
- clubs, their committees, and membership types that each club defines;
- hierarchical permissions: full admin → club officer (مسؤول نادي) → committee lead (مسؤول لجنة);
- a points ledger per member per committee (add, deduct, edit, cancel; every change is recorded).

This repository is the foundation: architecture, authorization, contracts for every phase-one endpoint, the design system, and one feature (the members list) built end to end as the pattern to copy. People sign in with a one-time code sent to their university email (the API is ready; the sign-in screens are the next task). In development you can also switch between seeded accounts with a dev-only switcher.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Getting started](#2-getting-started)
3. [Seeded accounts](#3-seeded-accounts)
4. [Running with mocks (no database)](#4-running-with-mocks-no-database)
5. [Scripts](#5-scripts)
6. [Project structure](#6-project-structure)
7. [How to work on a task](#7-how-to-work-on-a-task)
8. [Rules that must never be broken](#8-rules-that-must-never-be-broken)
9. [Adding a new feature module](#9-adding-a-new-feature-module)
10. [Troubleshooting](#10-troubleshooting)
11. [Where to ask and where things live](#11-where-to-ask-and-where-things-live)
12. [Deploying (Vercel + Neon)](#12-deploying-vercel--neon)

---

## 1. Prerequisites

| Tool    | Version                                            | Pinned in                                    |
| ------- | -------------------------------------------------- | -------------------------------------------- |
| Node.js | **24.21.0**                                        | `.nvmrc` — the only place the version is set |
| pnpm    | **12.10.1**                                        | `package.json` → `packageManager`            |
| Docker  | Docker Desktop 4.x / Docker Engine 29 with Compose | Runs the local PostgreSQL 18.                |
| Git     | 2.4x or newer                                      |                                              |

### Node.js: install it with fnm

Install Node through **[fnm](https://github.com/Schniz/fnm)** (Fast Node Manager), not the installer from nodejs.org. fnm reads the project's `.nvmrc` and switches to that version whenever you `cd` into the project, so everyone runs the same Node as CI and your other projects keep their own versions.

**Windows** (PowerShell; none of these steps need admin rights):

1. Install fnm:

   ```powershell
   winget install Schniz.fnm
   ```

2. Load fnm in every new PowerShell window, switching Node automatically on `cd`:

   ```powershell
   if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force | Out-Null }
   Add-Content $PROFILE 'fnm env --use-on-cd --version-file-strategy recursive --shell powershell | Out-String | Invoke-Expression'
   ```

   - If a new window then says _running scripts is disabled on this system_, allow your own scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
   - Using Git Bash too? Add this line to `~/.bashrc`: `eval "$(fnm env --use-on-cd --version-file-strategy recursive --shell bash)"`.

3. **Close every terminal and quit VS Code completely**, then reopen it. Terminals only see the new `PATH` after a full restart. Check with `fnm --version`.

**macOS** (with [Homebrew](https://brew.sh)):

1. Install fnm:

   ```bash
   brew install fnm
   ```

2. Load fnm in every new terminal, switching Node automatically on `cd`. zsh is the macOS default; for bash, use `--shell bash` and `~/.bash_profile` instead.

   ```bash
   echo 'eval "$(fnm env --use-on-cd --version-file-strategy recursive --shell zsh)"' >> ~/.zshrc
   ```

3. Open a new terminal and check with `fnm --version`.

On Linux, install fnm with [its install script](https://github.com/Schniz/fnm#installation); the shell setup is the same as on macOS.

**Install and use the project's Node version.** Run this inside the cloned repository (cloning is the first step of [Getting started](#2-getting-started)):

```bash
fnm install       # downloads the version in .nvmrc
fnm use           # switches to it; after this, entering the folder switches for you
node --version    # v24.21.0
```

### pnpm

```bash
npm install --global pnpm@12.10.1
pnpm --version    # 12.10.1
```

With fnm, global npm packages belong to the active Node version, so run this again after the project moves to a new Node version. If you already have pnpm 10 or newer, it reads `packageManager` and runs 12.10.1 inside this project on its own.

### Why installs fail on older Node versions

`pnpm install` stops before installing anything unless your Node version satisfies `engines` in `package.json`: `>=24.21.0 <25`, meaning the `.nvmrc` version or a newer release of the same major. `engineStrict: true` in `pnpm-workspace.yaml` makes this an error instead of a warning:

```text
ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported engine … wanted: {"node":">=24.21.0 <25"} (current: {"node":"<your version>"})
```

This is deliberate:

- **Dependencies need it.** jsdom 30, which the component tests run on, does not support Node 24 releases before 24.15.
- **One version everywhere.** CI runs exactly the `.nvmrc` version. An install error now is cheaper than a bug that only happens on one laptop.

To fix it, run `fnm use` in the project folder (or `fnm install` first if the version is missing), check `node --version`, and run `pnpm install` again.

### Docker

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows/macOS, or Docker Engine + the Compose plugin on Linux. Start it before the next step.

> **Windows:** clone the repository outside OneDrive (for example `C:\dev\digital-minds`). Syncing `node_modules` causes slow installs and file-lock errors.

---

## 2. Getting started

```bash
git clone https://github.com/Digital-Minds-Initiative/Digital-Minds-repo.git digital-minds
cd digital-minds
fnm use --install-if-missing  # the Node version in .nvmrc (see Prerequisites)
pnpm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
docker compose up -d          # starts PostgreSQL 18 on localhost:5432
pnpm db:reset                 # applies migrations and loads the demo data
pnpm dev
```

Open **http://localhost:3000**, click **«الدخول إلى لوحة التحكم»**, then choose an account from the **«حساب التجربة»** menu in the top bar (see [Seeded accounts](#3-seeded-accounts)). The members page is at **http://localhost:3000/dashboard/members**.

Other things to try:

- `curl http://localhost:3000/api/v1/health` → `{"status":"ok",…}`
- `pnpm storybook` → design system at **http://localhost:6006**

---

## 3. Seeded accounts

`pnpm db:reset` (or `pnpm db:seed`) loads two clubs — **نادي الحاسبات** (committees: البرمجة، التصميم، الفعاليات، الإعلام) and **نادي طويق** (التطوير، المحتوى، العلاقات العامة) — 30 people and about 250 point transactions over the last six months, including deductions, edited and cancelled ones. The same accounts exist in [mock mode](#4-running-with-mocks-no-database). Data lives in `src/shared/demo/demo.ts`.

| Persona                | Name                    | University email           | Role and scope                                                                                     |
| ---------------------- | ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| Full admin             | عبدالله محمد الغامدي    | `demo-staff-01@uqu.edu.sa` | Everything, in every club.                                                                         |
| Officer — Computing    | سارة عبدالرحمن القحطاني | `s000000001@st.uqu.edu.sa` | Everything in نادي الحاسبات.                                                                       |
| Officer — Tuwaiq       | فهد سعد العنزي          | `s000000002@st.uqu.edu.sa` | Everything in نادي طويق.                                                                           |
| **Mixed roles**        | نورة خالد الحربي        | `s000000003@st.uqu.edu.sa` | Officer of نادي الحاسبات; plain member of نادي طويق (in التطوير and المحتوى). Sees only Computing. |
| **Mixed roles**        | عبدالرحمن فيصل القرشي   | `s000000007@st.uqu.edu.sa` | Lead of Tuwaiq / التطوير; plain member of Computing / البرمجة.                                     |
| Lead                   | محمد عبدالله العتيبي    | `s000000004@st.uqu.edu.sa` | Lead of Computing / البرمجة (also a member of التصميم).                                            |
| Lead                   | ريم ناصر الشهري         | `s000000005@st.uqu.edu.sa` | Lead of Computing / التصميم.                                                                       |
| Lead of two committees | خالد إبراهيم المالكي    | `s000000006@st.uqu.edu.sa` | Lead of Computing / الفعاليات and الإعلام.                                                         |
| Co-lead                | إبراهيم يوسف الصاعدي    | `s000000010@st.uqu.edu.sa` | Second lead of Computing / البرمجة.                                                                |
| Lead                   | جود سلطان الأحمدي       | `s000000008@st.uqu.edu.sa` | Lead of Tuwaiq / المحتوى.                                                                          |
| Lead                   | ماجد حسن السلمي         | `s000000009@st.uqu.edu.sa` | Lead of Tuwaiq / العلاقات العامة.                                                                  |
| Member of both clubs   | يوسف علي الشمراني       | `s000000015@st.uqu.edu.sa` | Plain member; no dashboard access.                                                                 |
| Plain member           | فيصل أحمد الدوسري       | `s000000011@st.uqu.edu.sa` | Plain member of two committees; no dashboard access.                                               |
| Removed                | منى سعيد الحازمي        | `s000000018@st.uqu.edu.sa` | Removed from Computing (was a design lead — rights gone); still a member of Tuwaiq.                |
| No memberships         | مشاعل راشد اليامي       | `s000000027@st.uqu.edu.sa` | Registered, in no club.                                                                            |

Four more people (رهف، تركي، سلمان، ليان) were added by admins but have **not registered**, so they appear in member lists but cannot be selected as the current user — exactly like real unregistered accounts.

**Switching accounts (development only):**

- In the browser: the **«حساب التجربة»** dropdown in the dashboard header sets a `dm-dev-actor` cookie.
- From the command line: send the `X-Dev-Actor` header with the university email:

  ```bash
  curl -H "X-Dev-Actor: s000000001@st.uqu.edu.sa" "http://localhost:3000/api/v1/members?pageSize=5"
  ```

The switcher needs `DEV_ACTOR_SWITCHER=true` in `.env` (the default in `.env.example`) and only works with `pnpm dev` and in tests: it is compiled out of production builds, and a production server refuses to start with the flag set. A real session (below) always wins over the switcher.

**Signing in for real, locally.** `EMAIL_TRANSPORT` picks how the sign-in code reaches you:

- **`console`** (the default in development): no email is sent; the code is printed in the `pnpm dev` terminal.
- **`resend`**: the code is emailed for real, so you can test delivery to a university inbox. Put these in `.env.local` (git-ignored, and it overrides `.env`), then restart `pnpm dev`:

  ```bash
  EMAIL_TRANSPORT=resend
  EMAIL_FROM=Digital Minds <no-reply@auth.digitalmindsint.org>
  RESEND_API_KEY=re_…   # from the Resend dashboard; never commit it
  ```

  With `resend` and no key the app refuses to start and names the missing variable, rather than failing on the first sign-in. The sender's domain must be verified in Resend, or Resend refuses the message (the request answers a 500 and the server log says `Resend refused the email (HTTP 403)`). Tests always use the console sender, whatever `.env.local` says.

**Invite-only sign-in, locally.** `AUTH_SELF_SIGNUP` is `true` in development unless you set it, so any `@uqu.edu.sa` address can sign in and create an account. Production runs with `false` ([ADR 0027](docs/adr/0027-invite-only-sign-in.md)). To try that, put `AUTH_SELF_SIGNUP=false` in `.env.local` and restart `pnpm dev`. Then only full admins, club officers and committee leads get a code; any other address gets the same answer and nothing is printed. «إنشاء حساب» disappears and `/register` redirects to `/login`. Giving a role to someone who has never signed in prints their invitation email in the same terminal.

Until the sign-in screens exist, use curl (any seeded email, or any `@uqu.edu.sa` address to try the new-person flow):

```bash
# 1. Ask for a code. Every POST needs an Origin equal to APP_ORIGIN (http://localhost:3000 by default).
curl -X POST http://localhost:3000/api/v1/auth/otp/request   -H "Origin: http://localhost:3000" -H "Content-Type: application/json"   -d '{"email":"s000000001@st.uqu.edu.sa"}'

# 2. The pnpm dev terminal shows:  [dev email] to s44***@st.uqu.edu.sa — رمز الدخول إلى Digital Minds … رمز الدخول: 123456
#    Send it back and keep the session cookie:
curl -X POST http://localhost:3000/api/v1/auth/otp/verify -c cookies.txt   -H "Origin: http://localhost:3000" -H "Content-Type: application/json"   -d '{"email":"s000000001@st.uqu.edu.sa","code":"123456"}'
# → {"step":"signed_in"}   (an unregistered persona gets "confirm_name", a new address "enter_name":
#    finish with POST /api/v1/auth/profile/name {"fullName":"…"} using -b cookies.txt -c cookies.txt)

# 3. Use the session.
curl -b cookies.txt http://localhost:3000/api/v1/me
```

In the browser the same cookie (`dm-session`) is set by the sign-in screens. Open the app at `http://localhost:3000`, not `127.0.0.1`, or set `APP_ORIGIN` to match. How it works, the limits and the security rules: [ADR 0014](docs/adr/0014-email-otp-sign-in.md).

---

## 4. Running with mocks (no database)

Frontend work does not need PostgreSQL. Set one flag and every `/api/v1` request is answered in the browser by [MSW](https://mswjs.io) using the same contracts and the same demo accounts:

```bash
# in .env
NEXT_PUBLIC_API_MOCKING=enabled
```

Restart `pnpm dev` after changing it. Pick an account from **«حساب التجربة»** as usual. The sign-in endpoints are mocked too: code `123456` is accepted (`000000` → wrong code, `111111` → expired, `222222` → too many attempts); a seeded registered account is signed in, the unregistered ones are asked to confirm their name, any other `@uqu.edu.sa` address to enter one. Mock handlers live with each client feature (`src/client/features/<module>/mocks/`) and every response is validated against the module's contract, so a mock cannot drift from the real API. The flag is ignored by production builds.

---

## 5. Scripts

| Script                  | What it does                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`              | Starts the app at http://localhost:3000 with hot reload.                                                                             |
| `pnpm build`            | Production build (also type-checks).                                                                                                 |
| `pnpm start`            | Serves the production build (needs `DEV_ACTOR_SWITCHER=false`).                                                                      |
| `pnpm lint`             | ESLint, including the architecture boundary rules. `pnpm lint:fix` fixes what it can.                                                |
| `pnpm format`           | Formats everything with Prettier. `pnpm format:check` only checks.                                                                   |
| `pnpm knip`             | Finds unused files, exports and dependencies (configured in `knip.jsonc`; runs in CI).                                               |
| `pnpm typecheck`        | Generates Next.js route types, then runs the TypeScript compiler.                                                                    |
| `pnpm test`             | Unit tests (Vitest, no database). `pnpm test:watch` for watch mode.                                                                  |
| `pnpm test:integration` | Integration tests against the `digital_minds_test` database (created and wiped automatically).                                       |
| `pnpm test:e2e`         | Browser tests of the whole app per seeded persona, on `digital_minds_e2e_test` (created, reseeded).                                  |
| `pnpm db:migrate`       | Creates and applies a migration after you change `prisma/schema.prisma`.                                                             |
| `pnpm db:deploy`        | Applies pending migrations without creating new ones (the deploy workflow runs it).                                                  |
| `pnpm db:seed`          | Replaces all data in your local database with the demo data (hosted: dev only, §12.6).                                               |
| `pnpm db:reset`         | Drops the local database, re-applies every migration, then seeds.                                                                    |
| `pnpm db:studio`        | Opens Prisma Studio to browse the database.                                                                                          |
| `pnpm db:generate`      | Regenerates the Prisma client (runs automatically after `pnpm install`).                                                             |
| `pnpm db:backup`        | Encrypted `pg_dump` of a hosted database ([§12.9](#129-backups)).                                                                    |
| `pnpm db:restore`       | Restores such a backup into a database, after you type its host ([§12.9](#129-backups)).                                             |
| `pnpm admin:grant`      | Makes a university address a full admin, creating the account if needed ([§12.6](#126-first-deploy)).                                |
| `pnpm measure:bulk`     | Times concurrent full-size bulk-points batches against dev, before raising the limit ([§12.10](#1210-measuring-bulk-points-on-dev)). |
| `pnpm storybook`        | Design system and components at http://localhost:6006. `pnpm storybook:build` builds it statically.                                  |

---

## 6. Project structure

```text
.github/          CI, deploy and backup workflows, and the pull request template
.husky/           Git hooks: lint-staged on commit, commitlint on the message
.storybook/       Storybook config (theme and RTL/LTR toolbars)
.vscode/          Shared editor settings and recommended extensions
docs/             Architecture guide and decision records (ADRs)
prisma/           Database schema, migrations and the seed script
scripts/          Operations: admin:grant, measure:bulk, backup and restore, the database roles' grants
public/           Static files (including the MSW service worker)
src/
  app/            Next.js routes: [locale]/ pages and api/v1/ route handlers (thin)
  server/         Backend only: modules/<module>/ (service, repository, policies), authz, db, http, email, env
  client/         Frontend only: features/<module>/ (components, hooks, messages, mocks), lib/, mocks/
  shared/         Used by both: contracts/ (one file per module), lib/ (dates, phone…), demo/ (demo data)
  components/     Design system: ui/ primitives, patterns/, shell/ (layouts)
  styles/         Design tokens, global CSS and the app font
  i18n/           next-intl routing, request config and shared Arabic messages
tests/            Integration tests, factories and test setup
```

Read **[docs/architecture.md](docs/architecture.md)** before your first task: layers, request flow, the authorization model, and how to add a module.

---

## 7. How to work on a task

1. **Pick a task** from the [ClickUp list](https://app.clickup.com/1100380000022205/v/l/li/1100380000112612) and move it to _In progress_.
2. **Create a branch** from an up-to-date `develop`, named after the task:

   ```bash
   git switch develop && git pull
   git switch -c feat/<clickup-task-id>-short-name   # or fix/… or chore/…
   ```

3. **Follow the module pattern** ([docs/architecture.md](docs/architecture.md)). Look at the members module — `GET /api/v1/members` is the reference implementation.
4. **Contracts first:** add or update the endpoint in `src/shared/contracts/<module>.ts`. Backend and frontend then work against the same contract (frontend can start immediately with a mock).
5. **Write tests:** unit tests in a `__tests__/` folder next to the code; an integration test in `tests/integration/` for anything that reads or writes scoped data.
6. **Commit** with [Conventional Commits](https://www.conventionalcommits.org): `feat(members): add CSV import preview`, `fix(points): reject future work dates`. The commit hook formats, lints and checks the message.
7. **Open a pull request to `develop`** using the template; **link the ClickUp task** in it. The PR title must also be a Conventional Commit — it becomes the commit message.
8. **Get one review**, make CI green, then **squash and merge**. The merge deploys to https://dev.digitalmindsint.org. Delete the branch and move the ClickUp task to _Done_.

**Releases and hotfixes** ([§12](#12-deploying-vercel--neon) has the environments):

- **Release:** once `develop` has been checked on dev, open a PR from `develop` to `main` titled `chore(release): …` and merge it with **Create a merge commit** — never squash. A squash gives `main` commits that `develop` does not have, and every later release then conflicts. The merge deploys to production after a reviewer approves the deployment.
- **Hotfix:** branch `fix/…` from `main`, open the PR to `main`, and merge it with **Create a merge commit** (the only method `main` accepts). Then bring the fix into `develop` with a PR from `main` to `develop`, also merged with **Create a merge commit**.

Before pushing: `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm test:integration` if you changed server code).

---

## 8. Rules that must never be broken

1. **All scoped data goes through authz.** Every service function takes the `Actor` first; every query on scoped data uses a scope from `src/server/authz`. Data outside the actor's scope answers 404, never a leak.
2. **No Prisma outside repositories** (`src/server/modules/<module>/repository.ts`).
3. **No business logic in route handlers.** A handler is `defineRoute(contract, ({ actor, … }) => service(actor, …))`.
4. **No raw colours outside `src/styles/tokens.css`.** Components use semantic tokens (`bg-surface-1`, `text-danger`…).
5. **No hard-coded UI strings.** Text goes in `messages/ar.json` and is read with `useTranslations`.
6. **Logical CSS properties only** (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`); direction icons use `DirectionalIcon`.
7. **No secrets in git.** Only `.env.example` is committed; CI fails if any other `.env` file is tracked.
8. **Never reveal whether an account exists** before the person has proved they own the email (ADR 0014), and never weaken the sign-in limits or the dev switcher's production guards.

ESLint enforces 1–6 where possible (boundary rules, `server-only`, Tailwind class rules); the integration tests in `tests/integration/auth/` guard 8; review enforces the rest.

---

## 9. Adding a new feature module

Short version (full walkthrough with code in [docs/architecture.md → Adding a feature module](docs/architecture.md#adding-a-feature-module)):

- [ ] **Contract** (both sides agree first): `src/shared/contracts/<name>.ts` with `defineEndpoint` (Zod for params, query, body, response).
- [ ] **Backend:** `src/server/modules/<name>/{index,service,repository,policies}.ts`. Repository functions take a scope; services take the `Actor` first. New scopes or role predicates go in `src/server/authz` (with unit tests).
- [ ] **Backend:** route handlers in `src/app/api/v1/…/route.ts` using `defineRoute` and the module's `index.ts`.
- [ ] **Frontend:** `src/client/features/<name>/` with `mocks/index.ts` (registered in `src/client/mocks/handlers.ts`), then `components/`, `hooks/`, `index.ts` and `messages/ar.json` (registered in `src/i18n/messages.ts`).
- [ ] Unit tests in `__tests__/` next to the code.
- [ ] Integration tests for the authorization rules; stories for any new UI pattern.

---

## 10. Troubleshooting

**Port 3000 or 5432 already in use**

- App: `pnpm dev --port 3001`, or stop the process that holds port 3000.
- Database: another PostgreSQL is running. Set `POSTGRES_PORT=5433` in `.env`, change the port in `DATABASE_URL` and `TEST_DATABASE_URL` to `5433`, then `docker compose up -d`.

**Database not reachable** (`Can't reach database server`, `ECONNREFUSED`, health shows `"database":"down"`)

- Is Docker running? `docker compose ps` should show `digital-minds-db-1 … (healthy)`. If not: `docker compose up -d`.
- Does `DATABASE_URL` in `.env` match the port and credentials in `docker-compose.yml`?
- Start over with a clean volume: `docker compose down -v && docker compose up -d && pnpm db:reset`.

**Prisma client out of date** (type errors about missing fields, `Unknown argument`)

- `pnpm db:generate` (it also runs on every `pnpm install`), then restart `pnpm dev` and your editor's TypeScript server.

**Migrations out of sync** (`Drift detected`, `The migration … was modified`, `P3009`)

- Someone added a migration: `pnpm db:deploy` (or `pnpm db:reset` to start fresh — this deletes local data).
- You edited `schema.prisma`: `pnpm db:migrate` and commit the new folder in `prisma/migrations`.
- Never edit a migration that is already on `main`; add a new one.

**`pnpm install` fails**

- `ERR_PNPM_UNSUPPORTED_ENGINE`: the active Node version does not match `.nvmrc`. Run `fnm use` in the project folder; see [Why installs fail on older Node versions](#why-installs-fail-on-older-node-versions).
- `fnm` is not recognized, or `node --version` still shows another version in VS Code: quit VS Code completely and reopen it (its terminals keep the old `PATH`), and check that your shell profile has the `fnm env` line from [Prerequisites](#1-prerequisites).
- `ERR_PNPM_NO_MATURE_MATCHING_VERSION`: you added a package version published less than a day ago (supply-chain protection). Use the previous version or wait a day.
- `ERR_PNPM_IGNORED_BUILDS`: a new dependency wants to run an install script. Check what it does, then add it to `allowBuilds` in `pnpm-workspace.yaml`.

**The account switcher does nothing / everything is 401**

- `DEV_ACTOR_SWITCHER=true` must be in `.env`, and you must be running `pnpm dev` (not `pnpm start`). Restart after changing `.env`.
- Only registered accounts can be selected (see the table above).

**`403` with `"reason":"cross_origin"`, or sign-in does nothing in the browser**

- Every POST/PATCH/DELETE to `/api/v1` must come from `APP_ORIGIN` (default `http://localhost:3000`). Open the app at exactly that address (not `127.0.0.1`), or set `APP_ORIGIN` in `.env` when you use another port, and restart. From curl, send `-H "Origin: http://localhost:3000"`.

**No sign-in email arrives**

- With `EMAIL_TRANSPORT=console` (the development default) none is sent: the code is printed in the `pnpm dev` terminal. Set it to `resend` in `.env.local` to send for real (see "Signing in for real, locally" in [Seeded accounts](#3-seeded-accounts)).
- With `resend`: check the `pnpm dev` terminal for `Resend refused the email (HTTP …)` — a 403 usually means the `EMAIL_FROM` domain is not verified in Resend, a 401 a wrong key. Look in the spam folder too.
- A second request within 60 seconds answers `429 resend_cooldown`.

**Mock mode does not take effect**

- Restart `pnpm dev` after setting `NEXT_PUBLIC_API_MOCKING=enabled`, and hard-refresh the browser. After upgrading MSW, run `pnpm exec msw init public --save`.

**A `pg` warning: "Calling client.query() when the client is already executing a query is deprecated"**

- Harmless. It comes from Prisma's PostgreSQL adapter and will disappear with a Prisma update.

**Lint or format failures on Windows** (`Delete ␍`)

- The repository uses LF line endings (`.gitattributes`). Run `git config core.autocrlf false`, then `git add --renormalize .` and `pnpm format`.

---

## 11. Where to ask and where things live

| What                            | Where                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Tasks and priorities            | [ClickUp list](https://app.clickup.com/1100380000022205/v/l/li/1100380000112612)    |
| Phase-one feature spec          | [Feature spec](https://claude.ai/artifact/RXw6b3FUaV7ViKtbkV1MUt)                   |
| Code and pull requests          | [GitHub repository](https://github.com/Digital-Minds-Initiative/Digital-Minds-repo) |
| How the code is organised       | [docs/architecture.md](docs/architecture.md)                                        |
| Why things are the way they are | [docs/adr/](docs/adr/README.md)                                                     |
| Conventions for AI assistants   | [CLAUDE.md](CLAUDE.md)                                                              |

Questions about a task go in its ClickUp comments, so the answer stays with the task. If something in this README was unclear or wrong, fix it in your next pull request.

---

## 12. Deploying (Vercel + Neon)

| Environment | Git branch | URL                                   | Vercel environment | Neon branch  | Data      |
| ----------- | ---------- | ------------------------------------- | ------------------ | ------------ | --------- |
| Local       | any        | http://localhost:3000                 | —                  | — (Docker)   | demo seed |
| Dev         | `develop`  | https://dev.digitalmindsint.org       | Preview            | `dev`        | demo seed |
| Production  | `main`     | https://digitalmindsint.org (+ `www`) | Production         | `production` | real      |

Vercel's Git integration is **off**. The only way anything deploys is `.github/workflows/deploy.yml`, on a push to `develop` or `main`: CI → `vercel pull` → `vercel build` → `prisma migrate deploy` → grants (`scripts/sql/app-role.sql`) → `vercel deploy --prebuilt` (plus the `dev.` alias for `develop`). Production waits for a reviewer's approval. The reasons are in [ADR 0028](docs/adr/0028-hosting-and-deploys.md).

Three database roles per Neon branch:

| Role                   | Used by                                             | May                                                                 |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `digital_minds_owner`  | migrations, `db:seed`, `admin:grant` (`DIRECT_URL`) | everything (owns the tables)                                        |
| `digital_minds_app`    | the running app (`DATABASE_URL`, pooled)            | read and write rows; no DDL, no `TRUNCATE`, no `_prisma_migrations` |
| `digital_minds_backup` | the daily backup (`BACKUP_DATABASE_URL`)            | read                                                                |

> **Secrets never go into the chat, an issue, a commit or a file in this folder.** For the commands below that need a database URL, set it in the terminal so it is not saved in your shell history: `read -rs DIRECT_URL && export DIRECT_URL` (Git Bash; paste, then Enter), or `$env:DIRECT_URL = Read-Host` (PowerShell). Close the terminal when you are done.

Follow the steps in order the first time. Each one says where a value comes from.

### 12.1 Neon

The project `digital-minds` (AWS Europe Central 1, Postgres 18, database `digital_minds`, branches `production` and `dev`) already exists.

1. **Where the URLs are:** project → **Connect**. Pick the branch, database `digital_minds`, and role `digital_minds_owner`. **Connection pooling on** gives the pooled URL (its host contains `-pooler`); **off** gives the direct one. You need both, for each branch.
2. **Mark each branch with its environment.** Open the **SQL Editor** on the `production` branch and run:

   ```sql
   ALTER DATABASE digital_minds SET app.environment = 'production';
   ```

   Then switch to the `dev` branch and run it with `'dev'`. The seed and `measure:bulk` refuse every hosted database that does not say `dev`. A branch you later create from production inherits `'production'`, so it is refused too.

3. **Create the app and backup roles**, on **each** branch, in the SQL Editor as `digital_minds_owner`. Generate a different password for each role on each branch (four in all):

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

   ```sql
   CREATE ROLE digital_minds_app LOGIN PASSWORD '<generated>';
   CREATE ROLE digital_minds_backup LOGIN PASSWORD '<generated>';
   ```

   Create them with SQL, not in the console's Roles page: roles made there join `neon_superuser`, which is far more than the app needs. You do not run the grants by hand. The deploy workflow applies `scripts/sql/app-role.sql` after every migration.

4. **Build the URLs for the new roles.** Take the URL from step 1 and replace `digital_minds_owner:<password>` with the new role and its password:
   - the app: the **pooled** URL with `digital_minds_app` (→ Vercel's `DATABASE_URL`, §12.4);
   - the backup: production's **direct** URL with `digital_minds_backup` (→ GitHub's `BACKUP_DATABASE_URL`, §12.3).

   Keep them in your password manager.

### 12.2 Vercel

Use the Vercel CLI from this folder. The Git integration is never connected, so create the project here, not with "Import Git Repository":

1. `npx vercel@64.7.0 login`, then `npx vercel@64.7.0 link`. Answer **no** to linking an existing project, name it `digital-minds`, accept the detected Next.js settings, and answer **no** if it offers to connect the Git repository. This writes `.vercel/project.json` (git-ignored), which holds **`orgId`** and **`projectId`**: the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets in §12.3.
2. Dashboard → the project → **Settings**:
   - **Build and Deployment → Node.js Version:** `24.x` (the version in `.nvmrc`).
   - **Functions:** the region shows `fra1` (from `vercel.json`). Leave **Fluid compute** on.
   - **Deployment Protection → Vercel Authentication: off.** Otherwise only your Vercel account can open `dev.digitalmindsint.org`, and the app has its own sign-in.
   - **Git:** nothing to connect. `vercel.json` already turns Git deployments off.
3. **Environment Variables:** add each variable from §12.4 twice, once for **Production** and once for **Preview** (Preview is dev). Mark every secret as **Sensitive**. Never tick **Development**. Do not add `NODE_ENV`: Vercel sets it to `production` in both environments, which the app requires.
4. **Domains:** add `digitalmindsint.org` (Production), `www.digitalmindsint.org` as a **redirect to `digitalmindsint.org` (308)**, and `dev.digitalmindsint.org` with no branch (the deploy workflow aliases it to each `develop` deployment). The redirect matters: the app accepts form posts only from its own origin, so a `www` page that did not redirect would refuse every sign-in.
5. **Access token:** avatar → **Account Settings → Tokens → Create**. Scope: your Hobby account. Pick an expiry and write the date down, because deploys fail when it expires. This is `VERCEL_TOKEN`.

None of this needs Vercel Pro. Hobby's limits: non-commercial use, one member (only you can see the dashboard), and instant rollback only to the previous production deployment.

### 12.3 GitHub

1. **Make the repository public** once the history check in the handoff is settled: Settings → General → Danger Zone → Change visibility. That turns on branch protection, environment secrets and required reviewers, which the Free plan does not offer on private repositories.
2. **Settings → Actions → General:** under _Fork pull request workflows from outside collaborators_, choose **Require approval for all outside collaborators**. Leave _Workflow permissions_ on **Read repository contents**.
3. **Settings → General → Pull Requests:** tick **Allow merge commits** and **Allow squash merging**. Feature PRs are squashed; release PRs use a merge commit. Untick _Allow rebase merging_.
4. **Create `develop` from `main`** (after this PR is merged):

   ```bash
   git switch main && git pull
   git switch -c develop && git push -u origin develop
   ```

   Then **Settings → General → Default branch → `develop`**. New PRs then target `develop`, and the daily backup schedule runs from it.

5. **Rules:** Settings → Rules → Rulesets → **New branch ruleset**, one for each branch. Enforcement **Active**, no bypass list:

   | Rule                                                | `main`         | `develop`                |
   | --------------------------------------------------- | -------------- | ------------------------ |
   | Target                                              | `main`         | `develop`                |
   | Restrict deletions, Block force pushes              | ✓              | ✓                        |
   | Require a pull request · required approvals         | 1              | 1                        |
   | Dismiss stale approvals on new commits              | ✓              | ✓                        |
   | Allowed merge methods                               | **Merge** only | **Squash** and **Merge** |
   | Require status checks to pass · branches up to date | ✓              | ✓                        |

   Required checks (pick them after CI has run once on a PR): `No env files committed`, `PR title is a Conventional Commit`, `Typecheck, lint, unit tests, build`, `Integration tests (PostgreSQL)`. `develop` allows **Merge** too, for merging `main` back after a hotfix.

6. **Environments:** Settings → Environments → **New environment**, three of them:

   | Environment  | Deployment branches and tags | Required reviewers | Secrets                                                                                                           |
   | ------------ | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
   | `dev`        | Selected: `develop`          | —                  | `VERCEL_TOKEN` (§12.2), `DIRECT_URL` = **dev** direct URL, `digital_minds_owner`                                  |
   | `production` | Selected: `main`             | you (+ one more)   | `VERCEL_TOKEN` (same token), `DIRECT_URL` = **production** direct URL, `digital_minds_owner`                      |
   | `backup`     | Selected: `develop`          | —                  | `BACKUP_DATABASE_URL` = production direct URL, `digital_minds_backup` (§12.1 step 4); `BACKUP_PASSPHRASE` (below) |

   Tick **Prevent self-review** on `production` if two people can approve. The token is stored per environment rather than as a repository secret on purpose: a repository secret reaches any workflow on any branch, an environment secret only the branch its environment allows. The backup runs on a schedule, and schedules run from the default branch, so `backup` allows `develop`. It holds read-only access and needs no approval, so it never waits on anyone.

   Generate the backup passphrase with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and **store it in your password manager as well**: without it no backup can be read.

7. **Repository secrets** (Settings → Secrets and variables → Actions → _Repository secrets_): `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from `.vercel/project.json` (§12.2). They identify the project and are not sensitive, but the workflow reads them as secrets.

### 12.4 Environment variables (Vercel)

The same names in **Production** and **Preview**. The app refuses to start, naming the variable, when one is missing or unsafe (`src/server/env.ts`).

| Variable                  | Production                                          | Preview (dev)                                       |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`            | production **pooled** URL, `digital_minds_app`      | dev **pooled** URL, `digital_minds_app`             |
| `ALLOWED_EMAIL_DOMAINS`   | `uqu.edu.sa`                                        | `uqu.edu.sa`                                        |
| `APP_ORIGIN`              | `https://digitalmindsint.org`                       | `https://dev.digitalmindsint.org`                   |
| `AUTH_SECRET`             | the production secret                               | the dev secret                                      |
| `VIEW_LINK_SECRET`        | the production secret                               | the dev secret                                      |
| `CLIENT_IP_HEADER`        | `x-real-ip`                                         | `x-real-ip`                                         |
| `AUTH_SELF_SIGNUP`        | `false`                                             | `false`                                             |
| `RESEND_API_KEY`          | the production key                                  | the dev key                                         |
| `EMAIL_FROM`              | `Digital Minds <no-reply@auth.digitalmindsint.org>` | `Digital Minds <no-reply@auth.digitalmindsint.org>` |
| `DEV_ACTOR_SWITCHER`      | `false`                                             | `false`                                             |
| `NEXT_PUBLIC_API_MOCKING` | `disabled`                                          | `disabled`                                          |
| `EMAIL_ALLOWLIST`         | **never set**                                       | the testers' addresses, comma-separated             |

- **`EMAIL_ALLOWLIST` (dev only):** with it set, only the listed addresses receive email (sign-in codes and invitations). Every other send is logged as `Email skipped: the recipient is not on EMAIL_ALLOWLIST.`, without the address, and the API answers exactly as if it had gone out. So on dev, nobody outside the list is ever emailed, whatever address someone types or grants a role to. Add each tester (and yourself) before they sign in, then start a new dev deployment for the change to apply (Actions → the latest **Deploy** run on `develop` → **Re-run all jobs**). Vercel applies changed variables only to new deployments. A production deployment refuses to start with it set: the check uses `VERCEL_ENV`, which Vercel sets to `production` only there, so leave **Settings → Environment Variables → Automatically expose System Environment Variables** on.
- **Do not set** `DIRECT_URL` (it lives only in GitHub), `EMAIL_TRANSPORT` (production defaults to `resend` and refuses `console`), `NODE_ENV` (Vercel sets it) or `TEST_DATABASE_URL`.
- **Generate** each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, a different value per variable and per environment. Changing `AUTH_SECRET` later invalidates pending sign-in codes; changing `VIEW_LINK_SECRET` invalidates every committee view link.
- **`CLIENT_IP_HEADER=x-real-ip`:** Vercel sets `x-real-ip` to the address that connected and replaces whatever the client sent, so the per-IP limits on sign-in and on the public view cannot be dodged by forging it.
- With `AUTH_SELF_SIGNUP=false`, sign-in codes are sent after the response (`after()`). A failed send shows only in the logs (Vercel → project → Logs): watch for `The sign-in code email could not be sent.` and `The role invitation email could not be sent.` Either one means Resend is refusing mail ([ADR 0027](docs/adr/0027-invite-only-sign-in.md)).

### 12.5 DNS at IONOS

Vercel → Settings → Domains shows the exact records for each domain; **copy what it shows**, which may be a project-specific value. Typically:

| Host  | Type  | Value                                                  |
| ----- | ----- | ------------------------------------------------------ |
| `@`   | A     | the IP Vercel shows (often `76.76.21.21`)              |
| `www` | CNAME | the target Vercel shows (often `cname.vercel-dns.com`) |
| `dev` | CNAME | the same target                                        |

- At IONOS, delete the default **A** and **AAAA** records for `@` and `www` (the parking page) before adding these. A leftover AAAA record sends IPv6 visitors to IONOS.
- If the domain has **CAA** records, add one allowing `letsencrypt.org`, or Vercel cannot issue certificates.
- ⚠️ **Do not touch the records for `auth`**: `resend._domainkey.auth`, `send.auth` (MX and TXT), `_dmarc.auth` and anything else ending in `.auth`. They are what lets Resend send sign-in codes from `auth.digitalmindsint.org`, and changing them stops all sign-in email.

Vercel shows each domain as _Valid Configuration_ once DNS has propagated (minutes to a few hours).

### 12.6 First deploy

1. Finish §12.1–12.5. Then merge the PR that added this section into `main`. The push starts **Deploy** in the Actions tab: CI, then the production job, which waits for your approval (**Review deployments → Approve**). It migrates the empty production database, applies the grants and deploys. Open https://digitalmindsint.org.
2. Create `develop` (§12.3 step 4). That push deploys dev the same way, with no approval, and points `dev.digitalmindsint.org` at it.
3. **Seed dev** (replaces everything in the dev database with the demo data), with dev's **direct** owner URL:

   ```bash
   read -rs DIRECT_URL && export DIRECT_URL      # paste the dev direct URL
   ALLOW_SEED=true pnpm db:seed
   ```

   It refuses unless the database says `app.environment = 'dev'` (§12.1 step 2).

4. **Make yourself a full admin**, on dev and on production. The full-admin flag cannot be granted through the website. Set `DIRECT_URL` to that environment's direct URL (as above), then:

   ```bash
   pnpm admin:grant s44xxxxxxx@st.uqu.edu.sa --name "الاسم الكامل"
   ```

   It prints the database (host and `app.environment`) and what it did: _Created and granted_, _Granted_ or _No change_. `--name` is needed only for an address with no account yet; it is the name you confirm at your first sign-in. Seeding dev again wipes this, so run it again after every seed. On dev your address must also be in `EMAIL_ALLOWLIST`, or the code is never sent. The demo personas cannot sign in on dev: their addresses (`s000000001@st.uqu.edu.sa`, `demo-staff-01@uqu.edu.sa`…) are deliberately ones no person has.

5. Run the smoke test (§12.7) on dev, then on production.

### 12.7 Smoke test

Run it on **dev** first, then on **production** with real but harmless data. On production, remove what you created afterwards: points can be cancelled, a club can be archived, and a full admin can delete an empty club.

- [ ] Sign in with a real university address. The code arrives (**check Junk**), the name step works, and you land on the dashboard.
- [ ] Create a club and a committee (full admin).
- [ ] Add a member by university email.
- [ ] Make a second person (one who has never signed in) a committee lead: their invitation email arrives, and they can sign in.
- [ ] Add points to a member, then a bulk-points batch for several members.
- [ ] Import a CSV (preview, then import) using `GET …/import/template` as the starting file.
- [ ] Export the members list to Excel and open the file.
- [ ] Create a committee view link and open it on a phone, signed out: names and balances only.
- [ ] Open the browser console on a few pages: no Content-Security-Policy errors.
- [ ] Response headers (DevTools → Network → the page request): `content-security-policy` with a nonce, `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`. On the view link's API calls: `referrer-policy: no-referrer` and `x-robots-tag: noindex`.
- [ ] `https://www.digitalmindsint.org` redirects to `https://digitalmindsint.org`.

### 12.8 Rollback

**A bad deploy (code):**

- **Production:** Vercel → Deployments → the previous production deployment → **Instant Rollback**. It switches the domains back within seconds. Hobby can roll back only to the _previous_ production deployment; for an older one, open it → **Promote**. After a rollback Vercel stops giving new deployments the production domains, so the next deploy from `main` goes live only after you **Undo Rollback** or promote it. Fix forward with a hotfix (§7).
- **Dev:** `npx vercel@64.7.0 alias set <older deployment URL> dev.digitalmindsint.org`, with the URL from Vercel → Deployments.
- Rolling code back leaves the database as it is. That is safe only because every migration must keep working with the code before it: add things in one release, remove them in a later one (ADR 0028).

**A migration that failed:** the deploy job stops at _Migrate the database_. Nothing is deployed and the live site keeps running the previous code. Then:

1. Read the error in the job log. Prisma has recorded the migration as failed, and later deploys refuse to migrate (`P3009`) until it is resolved.
2. Check what the migration changed before it failed (Neon SQL Editor). Undo any part of it that was applied.
3. Mark it rolled back, with `DIRECT_URL` set for that environment: `pnpm exec prisma migrate resolve --rolled-back <migration_folder_name>`.
4. Fix the migration in a PR. A migration that never applied anywhere may be edited; otherwise add a new one. Merge it, and the deploy runs again.

**A migration that ran but damaged data:** within **6 hours**, Neon can restore the branch to a point in time (Neon → Branches → `production` → **Restore**, choosing a time before the deploy). Neon keeps the replaced state as a backup branch. After 6 hours, restore last night's backup (§12.9).

### 12.9 Backups

**Daily:** `.github/workflows/backup.yml` runs at 03:17 Riyadh time. It writes an encrypted dump (`pg_dump` custom format, AES-256 with `BACKUP_PASSPHRASE`) and keeps it as an artifact for **30 days**: Actions → **Backup** → a run → _Artifacts_. The repository is public, so anyone can download these files. The passphrase is what protects them: keep it long, keep it only in GitHub and your password manager, and rotate it if it might have leaked. GitHub stops scheduled workflows after 60 days without a commit and emails a warning first.

**By hand:** Actions → **Backup** → **Run workflow**. Or locally, with Docker and gpg (Git Bash):

```bash
read -rs BACKUP_DATABASE_URL && export BACKUP_DATABASE_URL   # production direct URL, digital_minds_backup
read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
pnpm db:backup                       # → backups/digital-minds-<UTC time>.dump.gpg (git-ignored)
```

**Restore**, into a new branch first, never straight into production:

1. Download the artifact you want and unzip it to get the `.dump.gpg` file.
2. Neon → Branches → **Create branch** from `production`, named e.g. `restore-2026-11-03`. Take its **direct** URL with `digital_minds_owner` (§12.1 step 1).
3. Restore into it:

   ```bash
   read -rs RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL   # the restore branch's direct URL
   read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
   pnpm db:restore path/to/digital-minds-….dump.gpg
   ```

   It shows the target and asks you to type its host. Then it replaces every table in **one transaction**: all of the backup lands, or nothing changes.

4. Re-apply the grants (the dump carries none): `DIRECT_URL="$RESTORE_DATABASE_URL" pnpm exec prisma db execute --file scripts/sql/app-role.sql`.
5. Check it in the Neon SQL Editor on that branch: the rows you expect, the latest `createdAt` values.
6. **Switch:** create one more branch from `production` as a snapshot of the state you are replacing. Then run steps 3 and 4 again with production's direct owner URL. Anything written to production after the backup was taken is lost, so compare first if that matters.
7. Delete the restore branch when you are done.

**A better home for backups, later:** workflow artifacts are public in a public repository, and they last at most 90 days. For real data, a private bucket (Cloudflare R2's free tier, with object lock) or Neon's paid plan (longer history) is better. `scripts/db-backup.sh` writes one file, so moving it means adding an upload step.

### 12.10 Measuring bulk points on dev

Not part of the launch: the club limit is already 2000 pairs with a 20 s transaction ([ADR 0022](docs/adr/0022-bulk-points.md), amendment). Run this against dev, never production, **before raising** `CLUB_POINTS_BULK_MAX` or the bulk transaction's timeout:

```bash
read -rs DIRECT_URL && export DIRECT_URL            # the dev direct URL (the script refuses non-dev databases)
pnpm measure:bulk setup                             # scratch club «قياس الحمل (مؤقت)»: CLUB_POINTS_BULK_MAX / 2 people × 2 committees
export MEASURE_ORIGIN=https://dev.digitalmindsint.org
read -rs MEASURE_SESSION && export MEASURE_SESSION  # your __Host-dm-session cookie value on dev (DevTools → Application → Cookies)
pnpm measure:bulk run 3                             # then `run 2`; prints each request's status and time
pnpm measure:bulk teardown                          # removes the scratch club, its people and its points
```

Use **teardown**, not the full-admin club delete: that refuses a club that ever had members. A request that takes longer than 20 seconds inside its transaction fails with a 500 and writes nothing. That is the edge the measurement is looking for.
