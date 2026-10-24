/*
 * Makes one person a full admin: `pnpm admin:grant <university email> [--name "<full name>"]`.
 *
 * The full-admin flag is deliberately not grantable through the API (docs/adr/0018-granting-roles.md),
 * so the first one on a new database — and any later one — is made here, by someone who holds the
 * database URL. An existing account is flagged; an address with no account gets one, which needs
 * --name: it is the name the person confirms at their first sign-in (ADR 0014), and only an officer
 * can change it afterwards.
 *
 * It connects with DIRECT_URL when set, else DATABASE_URL, and prints which database it touched.
 */
import nextEnv from '@next/env';
import { PrismaPg } from '@prisma/adapter-pg';

import { databaseEnvironment, describeDatabase, scriptDatabaseUrl } from './lib/database-target';
import { PrismaClient } from '../src/server/db/generated/client';
import { personNameSchema } from '../src/shared/contracts/core/fields';
import { normalizeForSearch } from '../src/shared/lib/arabic';
import {
  isAllowedEmailDomain,
  normalizeEmail,
  parseEmailDomains,
} from '../src/shared/lib/email-domains';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const USAGE = 'Usage: pnpm admin:grant <university email> [--name "<full name>"]';

function parseArgs(argv: string[]): { email: string; name: string | null } {
  let email: string | null = null;
  let name: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--name') {
      name = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (!arg.startsWith('--') && email === null) {
      email = arg;
    } else {
      throw new Error(`Unexpected argument "${arg}".\n${USAGE}`);
    }
  }
  if (!email) throw new Error(USAGE);
  return { email: normalizeEmail(email), name };
}

async function main(): Promise<void> {
  const { email, name } = parseArgs(process.argv.slice(2));
  const domains = parseEmailDomains(process.env.ALLOWED_EMAIL_DOMAINS ?? '');
  if (!isAllowedEmailDomain(email, domains)) {
    throw new Error(
      `${email} is not a university address (ALLOWED_EMAIL_DOMAINS: ${domains.join(', ') || 'empty'}).`,
    );
  }

  const url = scriptDatabaseUrl();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const environment = await databaseEnvironment(db);
    console.log(
      `Database: ${describeDatabase(url)} (app.environment: ${environment ?? 'not set'})`,
    );

    const existing = await db.user.findUnique({
      where: { uniEmail: email },
      select: { id: true, fullName: true, isFullAdmin: true, registeredAt: true },
    });

    if (existing) {
      if (existing.isFullAdmin) {
        console.log(`No change: ${email} (user ${existing.id}) is already a full admin.`);
        return;
      }
      await db.user.update({ where: { id: existing.id }, data: { isFullAdmin: true } });
      console.log(
        `Granted: ${email} (user ${existing.id}, «${existing.fullName}») is now a full admin. ` +
          (existing.registeredAt
            ? 'Their next request sees it.'
            : 'They have not signed in yet; their first sign-in confirms this name.'),
      );
      return;
    }

    if (name === null) {
      throw new Error(
        `${email} has no account yet. Add --name "<full name>": the name they will confirm at their first sign-in.`,
      );
    }
    const parsedName = personNameSchema.safeParse(name);
    if (!parsedName.success) throw new Error('--name must be 2 to 120 characters.');
    const fullName = parsedName.data;
    const created = await db.user.create({
      data: {
        fullName,
        searchName: normalizeForSearch(fullName),
        uniEmail: email,
        isFullAdmin: true,
      },
      select: { id: true },
    });
    console.log(
      `Created and granted: ${email} (user ${created.id}, «${fullName}») is a full admin. ` +
        'They sign in at /login with a code sent to that address and confirm this name.',
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
