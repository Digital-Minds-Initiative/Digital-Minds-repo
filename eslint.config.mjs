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
 *   1. src/client never imports src/server and vice versa; both may import src/shared, which imports
 *      neither (plus `import 'server-only'` in every server file).
 *   2. Server modules and client features are used only through their entry points.
 *   3. Only repositories touch the database; route handlers only use the http wrapper.
 *   4. No raw colours and no physical-direction (left/right) Tailwind classes.
 *   5. No Server Actions; no casts to scope types; contracts import only zod and other contracts.
 */

/** @param {string} dir */
const subfolders = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
const serverModules = subfolders('src/server/modules');
const clientFeatures = subfolders('src/client/features');

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
  './src/client/**/*',
  './src/components/**/*',
  './src/app/!(api)/**/*',
  './src/i18n/**/*',
  './src/styles/**/*',
  './.storybook/**/*',
];

/** Code that runs only on the server. */
const SERVER_CODE = ['./src/server/**/*', './src/app/api/**/*'];

/** Everything except repositories, the db folder itself and the authz actor repository. */
const NOT_DATA_ACCESS = [
  './src/app/**/*',
  './src/client/**/*',
  './src/components/**/*',
  './src/shared/**/*',
  './src/i18n/**/*',
  './src/*.ts',
  // At any depth inside a module: a helper in modules/<m>/sub/ is not a repository either.
  './src/server/modules/*/**/!(repository).ts',
  './src/server/!(db|authz|modules)/**/*',
  './src/server/*.ts',
];

/** One zone per server module: other code may use only its index.ts (plus `extraEntries`). */
const serverModuleZones = (/** @type {string[]} */ extraEntries = []) =>
  serverModules.map((name) => ({
    target: [
      `./src/server/modules/!(${name})/**/*`,
      './src/server/!(modules)/**/*',
      './src/server/*.ts',
      './src/app/**/*',
      './tests/**/*',
      './prisma/**/*',
    ],
    from: `./src/server/modules/${name}`,
    except: ['./index.ts', ...extraEntries],
    message: `Use the "${name}" server module through src/server/modules/${name}/index.ts.`,
  }));

/** One zone per client feature: other code may use only index.ts, mocks/index.ts and messages. */
const clientFeatureZones = () =>
  clientFeatures.map((name) => ({
    target: [
      `./src/client/features/!(${name})/**/*`,
      './src/client/!(features)/**/*',
      './src/components/**/*',
      './src/app/**/*',
      './src/i18n/**/*',
      './tests/**/*',
      './.storybook/**/*',
    ],
    from: `./src/client/features/${name}`,
    except: ['./index.ts', './mocks/index.ts', './messages'],
    message: `Use the "${name}" feature through src/client/features/${name}/index.ts (or mocks/index.ts).`,
  }));

const layerZones = [
  {
    target: CLIENT_CODE,
    from: './src/server',
    message:
      'Client code cannot import server code. Call the API through src/client/lib/api-client.ts instead.',
  },
  {
    target: SERVER_CODE,
    from: ['./src/client', './src/components'],
    message: 'Server code cannot import client code. Share it through src/shared instead.',
  },
  {
    target: './src/shared/**/*',
    from: ['./src/server', './src/client', './src/components', './src/app', './src/i18n'],
    message: 'src/shared is used by both sides, so it may import only zod and other shared code.',
  },
  {
    target: NOT_DATA_ACCESS,
    from: './src/server/db',
    message:
      'Only repositories (src/server/modules/<module>/repository.ts) may access the database.',
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
    except: ['./http', './modules'],
    message:
      'Route handlers only use src/server/http (defineRoute) and module services. Put logic in a service.',
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

/** Contracts may import zod, other contracts and src/shared/lib — nothing else. */
const CONTRACT_IMPORT_PATTERNS = [
  {
    regex: '^(react|react-dom|next)(/|$)|^@/(client|components|server|i18n|app)(/|$)|^@prisma/',
    message: 'Contracts are plain Zod: no React, Next.js, Prisma, server or UI code.',
  },
  {
    regex: '^@/shared/(?!contracts(/|$)|lib(/|$))',
    message: 'Contracts may import other contracts and src/shared/lib only.',
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
        { zones: windowsSafe([...layerZones, ...serverModuleZones(), ...clientFeatureZones()]) },
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
    // Contracts are shared with the browser and, later, the mobile app: zod, other contracts and
    // src/shared/lib only.
    files: ['src/shared/contracts/**/*.ts'],
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
    files: ['src/server/**/*.ts'],
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
        {
          zones: windowsSafe([
            ...layerZones,
            ...serverModuleZones(['./repository.ts']),
            ...clientFeatureZones(),
          ]),
        },
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
