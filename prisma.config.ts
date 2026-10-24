import path from 'node:path';

import nextEnv from '@next/env';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env files itself. Load them exactly like Next.js does
// (.env.local overrides .env, and so on) so every tool sees the same values.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: console.error,
});

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // The CLI (migrate, db seed, studio) uses DIRECT_URL when it is set: on Neon that is the
    // unpooled address with the owner role, because migrations need a session of their own and
    // rights the app role does not have. The running app never reads it (src/server/db/client.ts
    // uses DATABASE_URL). Locally it is unset and both are the Docker database.
    //
    // `prisma generate` runs on `pnpm install`, before a .env file exists, and does not
    // need a URL. Commands that do need one fail with a clear error when it is empty.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
