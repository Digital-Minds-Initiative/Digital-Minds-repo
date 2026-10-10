// Runs on `git commit` (via .husky/pre-commit) against staged files only.
export default {
  '*.{ts,tsx,mts,js,mjs}': ['eslint --fix --max-warnings 0 --no-warn-ignored', 'prettier --write'],
  '*.{json,md,css,yml,yaml}': 'prettier --write',
  'prisma/schema.prisma': () => 'prisma format',
};
