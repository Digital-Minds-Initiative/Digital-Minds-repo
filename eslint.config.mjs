// @ts-check
import { readdirSync } from 'node:fs';

import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import storybook from 'eslint-plugin-storybook';

/*
 * Architecture rules are enforced here, not just documented. See docs/architecture.md.
 *   1. Client code never imports server code (plus `import 'server-only'` in every server file).
 *   2. Modules are used only through their public entry points.
 *   3. Only repositories touch the database; route handlers only use the http wrapper.
 *   4. No raw colours and no physical-direction (left/right) Tailwind classes.
 *   5. No Server Actions; no casts to scope types; contracts import only zod and other contracts.
 */

const modules = readdirSync('src/modules', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * Windows-safe glob. eslint-plugin-import resolves patterns to absolute paths; on Windows the
 * backslash before a segment-leading `*` makes `is-glob` treat it as escaped, and the zone is
 * silently skipped. `?*` (one or more characters) matches the same names and stays a glob.
 * @param {string} pattern
 */
const glob = (pattern) => pattern.replace(/\/\*(?!\*)/g, '/?*');
/** @param {Array<{ target: string | string[]; from: string | string[] }>} zones */
const windowsSafe = (zones) =>
  zones.map((zone) => ({
    ...zone,
    target: [zone.target].flat().map(glob),
    from: [zone.from].flat().map(glob),
  }));

/** Code that can end up in the browser. */
const CLIENT_CODE = [
  './src/app/!(api)/**/*',
  './src/components/**/*',
  './src/lib/**/*',
  './src/i18n/**/*',
  './src/mocks/**/*',
  './src/styles/**/*',
  './src/modules/*/components/**/*',
  './src/modules/*/hooks/**/*',
  './src/modules/*/mocks/**/*',
  './src/modules/*/contracts.ts',
  './src/modules/*/index.ts',
  './.storybook/**/*',
];

const SERVER_CODE = ['./src/server/**/*', './src/modules/*/server/**/*'];

/** Everything except repositories, the db folder itself and authz may not touch the database. */
const NOT_DATA_ACCESS = [
  './src/app/**/*',
  './src/components/**/*',
  './src/lib/**/*',
  './src/i18n/**/*',
  './src/mocks/**/*',
  './src/*.ts',
  './src/modules/*/!(server)/**/*',
  './src/modules/*/*.ts',
  // At any depth under server/: a helper in server/sub/ is not a repository either.
  './src/modules/*/server/**/!(repository).ts',
  './src/server/!(db|authz)/**/*',
  './src/server/*.ts',
];

/** One zone per module: outside code may use only its entry points (plus `extraEntries`). */
const moduleZones = (/** @type {string[]} */ extraEntries = []) =>
  modules.map((name) => ({
    target: [
      `./src/modules/!(${name})/**/*`,
      './src/!(modules)/**/*',
      './src/*.ts',
      './tests/**/*',
      './prisma/**/*',
      './.storybook/**/*',
    ],
    from: `./src/modules/${name}`,
    except: [
      './index.ts',
      './contracts.ts',
      './server/index.ts',
      './mocks/index.ts',
      './messages',
      ...extraEntries,
    ],
    message: `Use the "${name}" module through its entry points: index.ts (UI), contracts.ts, server/index.ts (server) or mocks/index.ts.`,
  }));

const layerZones = [
  {
    target: CLIENT_CODE,
    from: SERVER_CODE,
    message:
      'Client code cannot import server code. Call the API through src/lib/api-client.ts instead.',
  },
  {
    target: NOT_DATA_ACCESS,
    from: './src/server/db',
    message:
      'Only repositories (src/modules/<module>/server/repository.ts) may access the database.',
  },
  {
    // authz builds scopes from the generated Prisma types; only the actor repository queries.
    target: './src/server/authz/**/!(actor-repository).ts',
    from: './src/server/db',
    except: ['./generated'],
    message:
      'In src/server/authz only actor-repository.ts may query the database (types from ./generated are fine).',
  },
  {
    target: './src/app/api/**/*',
    from: './src/server',
    except: ['./http'],
    message:
      'Route handlers only use src/server/http (defineRoute). Put logic in a module service.',
  },
];

const RESTRICTED_IMPORT_PATHS = [
  { name: 'next/link', message: 'Use Link from @/i18n/navigation (locale-aware).' },
  {
    name: 'next/navigation',
    importNames: ['useRouter', 'usePathname', 'redirect', 'permanentRedirect'],
    message: 'Use the locale-aware versions from @/i18n/navigation.',
  },
  {
    name: '@prisma/client',
    message: 'Use the generated client (src/server/db) from a repository.',
  },
];

/** Contracts may import zod, @/lib/contracts and other modules' contracts — nothing else. */
const CONTRACT_IMPORT_PATTERNS = [
  {
    regex: '^(react|react-dom|next)(/|$)|^@/(components|server|i18n)(/|$)|^@prisma/',
    message: 'Contracts are plain Zod: no React, Next.js, Prisma, server or UI code.',
  },
  {
    regex: '^@/modules/[^/]+(/(?!contracts$).*)?$',
    message: "Contracts may import another module's contracts.ts only.",
  },
];

/** Raw colours in inline styles bypass the design tokens. */
const RAW_COLOUR_STYLE = {
  selector:
    "JSXAttribute[name.name='style'] Property > Literal[value=/#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\(|oklch\\(/]",
  message: 'Use semantic tokens (Tailwind classes) instead of raw colours in styles.',
};

/** All UI data goes through /api/v1 (ADR 0006). */
const SERVER_ACTION = {
  selector: "ExpressionStatement[directive='use server']",
  message: 'No Server Actions: UI data goes through /api/v1 route handlers (docs/adr/0006).',
};

/** Scopes come only from src/server/authz/scopes.ts; a cast would forge one. */
const SCOPE_CASTS = ['TSAsExpression', 'TSTypeAssertion']
  .flatMap((node) => [
    `${node} > TSTypeReference[typeName.name=/Scope$/]`,
    `${node} > TSTypeReference[typeName.right.name=/Scope$/]`,
  ])
  .map((selector) => ({
    selector,
    message: 'Never cast to a scope type: build scopes with the functions in src/server/authz.',
  }));

/** Local rule: every server file imports 'server-only', so Next.js refuses to bundle it for the browser. */
const localPlugin = {
  rules: {
    'require-server-only': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          missing:
            "Server code must import 'server-only' (first import) so it can never reach a browser bundle.",
        },
      },
      create(context) {
        return {
          Program(node) {
            const found = node.body.some(
              (statement) =>
                statement.type === 'ImportDeclaration' && statement.source.value === 'server-only',
            );
            if (!found) context.report({ node, messageId: 'missing' });
          },
        };
      },
    },
  },
};

/** Physical-direction classes and raw colours ($0 is the offending class). */
const restrictedClasses = [
  {
    pattern: '^(?:.*:)?-?(?:m|p|scroll-m|scroll-p)[lr]-.+$',
    message: '"$0" is a physical direction. Use ms-/me-/ps-/pe- so it flips in RTL.',
  },
  {
    pattern: '^(?:.*:)?-?(?:left|right)-.+$',
    message: '"$0" is a physical direction. Use start-/end- so it flips in RTL.',
  },
  {
    pattern: '^(?:.*:)?(?:border|rounded)-(?:l|r|tl|tr|bl|br)(?:-.+)?$',
    message: '"$0" is a physical direction. Use the logical s/e variants (border-s, rounded-e…).',
  },
  {
    pattern: '^(?:.*:)?(?:text|float|clear)-(?:left|right)$',
    message: '"$0" is a physical direction. Use the -start/-end variant.',
  },
  {
    pattern: '(?:#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|--palette-)',
    message:
      '"$0" uses a raw colour or a primitive token. Use a semantic token (bg-surface-1, text-danger…).',
  },
];

export default defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'storybook-static/**',
    'next-env.d.ts',
    'public/mockServiceWorker.js',
    'src/server/db/generated/**',
    'prisma/migrations/**',
  ]),

  ...nextVitals,
  ...nextTypescript,
  eslintComments.recommended,
  ...storybook.configs['flat/recommended'],

  {
    name: 'digital-minds/general',
    rules: {
      // Any eslint-disable must say why.
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: true }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-restricted-paths': [
        'error',
        { zones: windowsSafe([...layerZones, ...moduleZones()]) },
      ],

      'no-restricted-imports': ['error', { paths: RESTRICTED_IMPORT_PATHS }],
      'no-restricted-syntax': ['error', RAW_COLOUR_STYLE, SERVER_ACTION, ...SCOPE_CASTS],
    },
  },

  {
    name: 'digital-minds/scopes',
    // The one place that creates scopes (by casting a where clause to its branded type).
    files: ['src/server/authz/scopes.ts'],
    rules: { 'no-restricted-syntax': ['error', RAW_COLOUR_STYLE, SERVER_ACTION] },
  },

  {
    name: 'digital-minds/contracts',
    // Contracts are shared with the browser and, later, the mobile app: zod, @/lib/contracts and
    // other modules' contracts only.
    files: ['src/modules/*/contracts.ts', 'src/lib/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: RESTRICTED_IMPORT_PATHS, patterns: CONTRACT_IMPORT_PATTERNS },
      ],
    },
  },

  {
    name: 'digital-minds/type-aware',
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },

  {
    name: 'digital-minds/server-only',
    files: ['src/server/**/*.ts', 'src/modules/*/server/**/*.ts'],
    ignores: ['src/server/db/generated/**', '**/*.test.ts'],
    plugins: { local: localPlugin },
    rules: { 'local/require-server-only': 'error' },
  },

  {
    name: 'digital-minds/tailwind',
    files: ['src/**/*.{ts,tsx}', '.storybook/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: 'src/styles/globals.css' } },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: restrictedClasses }],
    },
  },

  {
    name: 'digital-minds/repository-tests',
    // Tests of the write scopes (the second line of defence) call repositories directly, because
    // services always run a scoped read first and would hide a missing scope on the write.
    files: ['tests/integration/repositories/**/*.ts'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        { zones: windowsSafe([...layerZones, ...moduleZones(['./server/repository.ts'])]) },
      ],
    },
  },

  {
    name: 'digital-minds/scripts-and-tests',
    files: ['prisma/**/*.ts', 'tests/**/*.ts', '**/*.test.{ts,tsx}', '*.config.{ts,mjs}'],
    rules: {
      // Scripts and tests may log.
      'no-console': 'off',
    },
  },

  {
    name: 'digital-minds/tool-configs',
    files: ['*.config.{ts,mjs}'],
    rules: {
      // Tool config files conventionally `export default { … }`.
      'import/no-anonymous-default-export': 'off',
    },
  },

  prettier,
]);
