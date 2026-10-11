# Digital Minds

Digital Minds (العقول الرقمية) is the platform for the tech student clubs at Umm Al-Qura University. Clubs (نادي الحاسبات، نادي طويق، …) manage their members, committees and points in one place. The UI is Arabic and right-to-left.

**Phase one** covers the members & points module (الموارد) and a simple landing page:

- one account per person, identified by the university email; admins can add people before they register;
- clubs, their committees, and membership types that each club defines;
- hierarchical permissions: full admin → club officer (مدير شؤون) → committee lead (قائد لجنة);
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
12. [Deploying to production](#12-deploying-to-production)

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
| Full admin             | عبدالله محمد الغامدي    | `aalghamdi@uqu.edu.sa`     | Everything, in every club.                                                                         |
| Officer — Computing    | سارة عبدالرحمن القحطاني | `s443001102@st.uqu.edu.sa` | Everything in نادي الحاسبات.                                                                       |
| Officer — Tuwaiq       | فهد سعد العنزي          | `s442002118@st.uqu.edu.sa` | Everything in نادي طويق.                                                                           |
| **Mixed roles**        | نورة خالد الحربي        | `s443003127@st.uqu.edu.sa` | Officer of نادي الحاسبات; plain member of نادي طويق (in التطوير and المحتوى). Sees only Computing. |
| **Mixed roles**        | عبدالرحمن فيصل القرشي   | `s443005244@st.uqu.edu.sa` | Lead of Tuwaiq / التطوير; plain member of Computing / البرمجة.                                     |
| Lead                   | محمد عبدالله العتيبي    | `s444001205@st.uqu.edu.sa` | Lead of Computing / البرمجة (also a member of التصميم).                                            |
| Lead                   | ريم ناصر الشهري         | `s444002216@st.uqu.edu.sa` | Lead of Computing / التصميم.                                                                       |
| Lead of two committees | خالد إبراهيم المالكي    | `s443004231@st.uqu.edu.sa` | Lead of Computing / الفعاليات and الإعلام.                                                         |
| Co-lead                | إبراهيم يوسف الصاعدي    | `s444004278@st.uqu.edu.sa` | Second lead of Computing / البرمجة.                                                                |
| Lead                   | جود سلطان الأحمدي       | `s444003252@st.uqu.edu.sa` | Lead of Tuwaiq / المحتوى.                                                                          |
| Lead                   | ماجد حسن السلمي         | `s442006263@st.uqu.edu.sa` | Lead of Tuwaiq / العلاقات العامة.                                                                  |
| Member of both clubs   | يوسف علي الشمراني       | `s444006345@st.uqu.edu.sa` | Plain member; no dashboard access.                                                                 |
| Plain member           | فيصل أحمد الدوسري       | `s445001301@st.uqu.edu.sa` | Plain member of two committees; no dashboard access.                                               |
| Removed                | منى سعيد الحازمي        | `s443006378@st.uqu.edu.sa` | Removed from Computing (was a design lead — rights gone); still a member of Tuwaiq.                |
| No memberships         | مشاعل راشد اليامي       | `s445008468@st.uqu.edu.sa` | Registered, in no club.                                                                            |

Four more people (رهف، تركي، سلمان، ليان) were added by admins but have **not registered**, so they appear in member lists but cannot be selected as the current user — exactly like real unregistered accounts.

**Switching accounts (development only):**

- In the browser: the **«حساب التجربة»** dropdown in the dashboard header sets a `dm-dev-actor` cookie.
- From the command line: send the `X-Dev-Actor` header with the university email:

  ```bash
  curl -H "X-Dev-Actor: s443001102@st.uqu.edu.sa" "http://localhost:3000/api/v1/members?pageSize=5"
  ```

The switcher needs `DEV_ACTOR_SWITCHER=true` in `.env` (the default in `.env.example`) and only works with `pnpm dev` and in tests: it is compiled out of production builds, and a production server refuses to start with the flag set. A real session (below) always wins over the switcher.

**Signing in for real, locally.** Without `RESEND_API_KEY` in `.env`, no email is sent: the code is printed in the `pnpm dev` terminal instead. Until the sign-in screens exist, use curl (any seeded email, or any `@uqu.edu.sa` address to try the new-person flow):

```bash
# 1. Ask for a code. Every POST needs an Origin equal to APP_ORIGIN (http://localhost:3000 by default).
curl -X POST http://localhost:3000/api/v1/auth/otp/request   -H "Origin: http://localhost:3000" -H "Content-Type: application/json"   -d '{"email":"s443001102@st.uqu.edu.sa"}'

# 2. The pnpm dev terminal shows:  [dev email] to s44***@st.uqu.edu.sa — رمز الدخول إلى Digital Minds … رمز الدخول: 123456
#    Send it back and keep the session cookie:
curl -X POST http://localhost:3000/api/v1/auth/otp/verify -c cookies.txt   -H "Origin: http://localhost:3000" -H "Content-Type: application/json"   -d '{"email":"s443001102@st.uqu.edu.sa","code":"123456"}'
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

Restart `pnpm dev` after changing it. Pick an account from **«حساب التجربة»** as usual. The sign-in endpoints are not mocked yet; their mocks come with the sign-in screens. Mock handlers live with each client feature (`src/client/features/<module>/mocks/`) and every response is validated against the module's contract, so a mock cannot drift from the real API. The flag is ignored by production builds.

---

## 5. Scripts

| Script                  | What it does                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Starts the app at http://localhost:3000 with hot reload.                                            |
| `pnpm build`            | Production build (also type-checks).                                                                |
| `pnpm start`            | Serves the production build (needs `DEV_ACTOR_SWITCHER=false`).                                     |
| `pnpm lint`             | ESLint, including the architecture boundary rules. `pnpm lint:fix` fixes what it can.               |
| `pnpm format`           | Formats everything with Prettier. `pnpm format:check` only checks.                                  |
| `pnpm knip`             | Finds unused files, exports and dependencies (configured in `knip.jsonc`; runs in CI).              |
| `pnpm typecheck`        | Generates Next.js route types, then runs the TypeScript compiler.                                   |
| `pnpm test`             | Unit tests (Vitest, no database). `pnpm test:watch` for watch mode.                                 |
| `pnpm test:integration` | Integration tests against the `digital_minds_test` database (created and wiped automatically).      |
| `pnpm db:migrate`       | Creates and applies a migration after you change `prisma/schema.prisma`.                            |
| `pnpm db:deploy`        | Applies pending migrations without creating new ones (CI, production).                              |
| `pnpm db:seed`          | Replaces all data in your local database with the demo data.                                        |
| `pnpm db:reset`         | Drops the local database, re-applies every migration, then seeds.                                   |
| `pnpm db:studio`        | Opens Prisma Studio to browse the database.                                                         |
| `pnpm db:generate`      | Regenerates the Prisma client (runs automatically after `pnpm install`).                            |
| `pnpm storybook`        | Design system and components at http://localhost:6006. `pnpm storybook:build` builds it statically. |

---

## 6. Project structure

```text
.github/          CI workflow and pull request template
.husky/           Git hooks: lint-staged on commit, commitlint on the message
.storybook/       Storybook config (theme and RTL/LTR toolbars)
.vscode/          Shared editor settings and recommended extensions
docs/             Architecture guide and decision records (ADRs)
prisma/           Database schema, migrations and the seed script
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
2. **Create a branch** from an up-to-date `main`, named after the task:

   ```bash
   git switch main && git pull
   git switch -c feat/<clickup-task-id>-short-name   # or fix/… or chore/…
   ```

3. **Follow the module pattern** ([docs/architecture.md](docs/architecture.md)). Look at the members module — `GET /api/v1/members` is the reference implementation.
4. **Contracts first:** add or update the endpoint in `src/shared/contracts/<module>.ts`. Backend and frontend then work against the same contract (frontend can start immediately with a mock).
5. **Write tests:** unit tests in a `__tests__/` folder next to the code; an integration test in `tests/integration/` for anything that reads or writes scoped data.
6. **Commit** with [Conventional Commits](https://www.conventionalcommits.org): `feat(members): add CSV import preview`, `fix(points): reject future work dates`. The commit hook formats, lints and checks the message.
7. **Open a pull request to `main`** using the template; **link the ClickUp task** in it. The PR title must also be a Conventional Commit — it becomes the commit message.
8. **Get one review**, make CI green, then **squash and merge**. Delete the branch and move the ClickUp task to _Done_.

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

- Without `RESEND_API_KEY` none is sent: the code is printed in the `pnpm dev` terminal. A second request within 60 seconds answers `429 resend_cooldown`.

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

## 12. Deploying to production

Hosting is not decided yet; whatever runs the app must provide these. A production server (`pnpm start`) checks them at startup and refuses to start, naming each missing or unsafe variable (`src/server/env.ts`).

| Variable                                        | Production value                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `ALLOWED_EMAIL_DOMAINS`         | the production database, `uqu.edu.sa`                                                                                                                                                                                                                                                       |
| `APP_ORIGIN`                                    | the public URL people open, e.g. `https://app.digitalmindsint.org` (CSRF check)                                                                                                                                                                                                             |
| `AUTH_SECRET`                                   | your own random value, at least 32 characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)                                                                                                                                                               |
| `RESEND_API_KEY`, `EMAIL_FROM`                  | the Resend key and `Digital Minds <no-reply@auth.digitalmindsint.org>`                                                                                                                                                                                                                      |
| `CLIENT_IP_HEADER`                              | **required, no default.** The header your reverse proxy sets with the client IP (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, …), so the per-IP sign-in limits work; or `none` to run without them deliberately. Never name a header the proxy does not set: clients could forge it. |
| `DEV_ACTOR_SWITCHER`, `NEXT_PUBLIC_API_MOCKING` | `false` and `disabled` (the server refuses anything else)                                                                                                                                                                                                                                   |

Run `pnpm db:deploy` before starting a new version. The details behind the sign-in settings are in [ADR 0014](docs/adr/0014-email-otp-sign-in.md).
