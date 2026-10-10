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
    // `prisma generate` runs on `pnpm install`, before a .env file exists, and does not
    // need a URL. Commands that do need one fail with a clear error when it is empty.
    url: process.env.DATABASE_URL ?? '',
  },
});
