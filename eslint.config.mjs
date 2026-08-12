// Next.js presets + the agent-starter type-aware rule set.
//
// Division of labour: Biome does formatting and fast syntactic rules (biome.jsonc);
// eslint-config-next does the React and Next-specific checks; the block below adds
// only what neither can do, which is type-aware analysis and plugin checks
// (import resolution, complexity, security).
//
// Rationale and tier-by-tier breakdown: agent-starter guides/lint-rules-for-ai.md.

import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import comments from 'eslint-plugin-eslint-comments'
import importPlugin from 'eslint-plugin-import'
import security from 'eslint-plugin-security'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

import {
  DESIGN_SYSTEM_RESTRICTED_SYNTAX,
  REACT_CORRECTNESS_RESTRICTED_SYNTAX,
  SERVER_ACTION_RESTRICTED_SYNTAX,
} from './eslint.restricted-syntax.mjs'

const eslintConfig = defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    '.open-next/**',
    '.wrangler/**',
    'coverage/**',
    'next-env.d.ts',
    'worker-configuration.d.ts',
    // Git worktrees live here, and a worktree is a COMPLETE second copy of this
    // repository nested inside it: its own src, its own tests, its own node_modules,
    // and its own built .next. Without this line a bare `eslint` walks into all of
    // that. Every entry above is root-anchored, so `.next/**` does not match
    // `.claude/worktrees/<name>/.next`, and linting a build output is what turns the
    // run into a heap exhaustion: measured at 4GB and dead after five and a half
    // minutes, then 65,044 problems on an 8GB heap, none of them from this checkout.
    '.claude/worktrees/**',
  ]),

  ...nextVitals,
  ...nextTs,
  // Scoped to TS only: type-aware rules cannot run on this .mjs config itself.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      import: importPlugin,
      sonarjs,
      security,
      'eslint-comments': comments,
    },
    settings: {
      // Without this, `import/no-unresolved` fails on every `@/` path alias.
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      // ── Tier 1: Type-aware correctness ─────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowNullableObject: true, allowNullableBoolean: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-readonly': 'error',

      // ── Tier 2: Imports ───────────────────────────────────────────────────
      'import/no-unresolved': 'error',
      'import/no-cycle': ['error', { maxDepth: 10 }],
      'import/no-self-import': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',

      // ── Tier 3: Agent-specific traps ──────────────────────────────────────
      'no-warning-comments': ['warn', { terms: ['fixme', 'xxx', 'hack'], location: 'anywhere' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read config through src/utils/env.ts; bindings through src/utils/cf.ts.',
        },
      ],
      'eslint-comments/require-description': ['error', { ignore: [] }],
      'eslint-comments/no-unlimited-disable': 'error',
      'eslint-comments/no-unused-disable': 'error',

      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement > NewExpression[callee.name="Error"]',
          message:
            'Throw AppError(ErrorIds.X, ...) from src/constants/errorIds.ts, or return a Result. A bare Error has no ID to grep for.',
        },
        // shadcn/ui is mandatory. See eslint.restricted-syntax.mjs for why this is
        // a lint error rather than a documented preference.
        ...DESIGN_SYSTEM_RESTRICTED_SYNTAX,
        // React scheduling mistakes that no test in this repo can see, for the same
        // reason: there is no DOM test environment.
        ...REACT_CORRECTNESS_RESTRICTED_SYNTAX,
        // The `'use server'` module boundary, where the failure is a 500 on every
        // action in the file and both the build and the type-checker are silent.
        ...SERVER_ACTION_RESTRICTED_SYNTAX,
      ],

      // The Airtable SDK is a boundary, not a utility. Everything else goes
      // through the cached DAL, which owns tags and validation. This is a
      // `no-restricted-imports` pattern rather than a `no-restricted-syntax`
      // selector precisely so the block below can re-allow it inside the one
      // directory that implements the boundary; the previous selector form was
      // global with no exemption, which banned the sanctioned implementation
      // along with everything else (Codex review finding 18).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['../../../*'], message: 'Use the @/ alias instead of deep relative paths.' },
            {
              // Anchored with a leading slash. These patterns are matched
              // gitignore-style (eslint/lib/rules/no-restricted-imports.js uses
              // the `ignore` package), so a bare `airtable` matched ANY path
              // segment called airtable, which banned `@/services/airtable/...`
              // everywhere and left the DAL with no legal consumers.
              group: ['/airtable'],
              message:
                'Only src/services/airtable may import the airtable package. Read through the typed DAL, which owns cacheTag, invalidation, and Zod mapping.',
            },
            {
              // Same shape, same reason: the Anthropic SDK is a boundary. Everything
              // else calls through `complete()` in src/services/ai, which owns the
              // model id, the cache breakpoint, structured-output parsing, refusal
              // handling, and the mock that lets a keyless clone demo the features.
              group: ['/@anthropic-ai/sdk'],
              message:
                'Only src/services/ai may import @anthropic-ai/sdk. Call complete() from @/services/ai, which owns the model, refusals, and the mock.',
            },
          ],
        },
      ],

      // ── Tier 4: Complexity ────────────────────────────────────────────────
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 3],
      'max-params': ['warn', 4],

      // ── Tier 5: Security ──────────────────────────────────────────────────
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // ── Window properties that shadow a variable you forgot to declare ─────
      // A typo'd or renamed local named `status` does not fail to compile: it
      // resolves to `window.status`, a real string global, so `{status}` renders
      // an empty string and `status === undefined` type-checks as a comparison
      // that is merely always false. That shipped once, in GlobalSearch.tsx, and
      // it is invisible in review because the code reads correctly. These are the
      // ambient names with no plausible bare use in this codebase; `location`,
      // `history`, `origin` and `self` are deliberately NOT here, because reading
      // those off the window bare is ordinary.
      'no-restricted-globals': [
        'error',
        { name: 'status', message: 'Ambient window.status. Declare a local, e.g. statusMessage.' },
        { name: 'name', message: 'Ambient window.name. Declare a local with a specific name.' },
        { name: 'length', message: 'Ambient window.length. Declare a local.' },
        { name: 'event', message: 'Ambient window.event. Take the event as a handler parameter.' },
        { name: 'closed', message: 'Ambient window.closed. Declare a local.' },
        { name: 'parent', message: 'Ambient window.parent. Declare a local.' },
        { name: 'top', message: 'Ambient window.top. Declare a local.' },
      ],

      // ── Owned by Biome, off here so they do not double-fire ────────────────
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  {
    // The two boundary files are the exceptions their own rules exist to create.
    files: ['src/utils/env.ts', 'src/utils/cf.ts', '*.config.{ts,mjs,js}', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  {
    // These ARE the two SDK boundaries, so they are the one place each SDK may be
    // imported. Everything else in the tree still hits the ban above.
    files: ['src/services/airtable/**', 'src/services/ai/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['../../../*'], message: 'Use the @/ alias instead of deep relative paths.' },
          ],
        },
      ],
    },
  },

  {
    // Worker entrypoints import `.open-next/worker.js`, which is generated,
    // untyped JavaScript that does not exist until `npm run cf:build` has run.
    // Whether TypeScript resolves it through the ambient shim in
    // open-next-worker.d.ts or through the real file (which infers as `any`)
    // depends on build order, so the unsafe-* rules would fire only sometimes.
    // Turning them off for this one directory is deterministic; inline disables
    // would not be, because `eslint-comments/no-unused-disable` errors on a
    // disable that turns out to be unnecessary.
    files: ['src/entrypoints/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Deep relative import of the generated bundle is the whole point here.
      'no-restricted-imports': 'off',
    },
  },

  {
    // Generated shadcn source. These files ARE the sanctioned implementation of
    // the primitives the design-system rules point at, so they are the one place
    // raw host elements and @radix-ui imports are correct. Never hand-edit them
    // to add project styling; re-run `npx shadcn@latest add <name>` instead and
    // wrap the result in src/components/primitives if it needs project behavior.
    files: ['src/components/ui/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Generated code uses `||`. Editing it to satisfy lint is exactly what the
      // do-not-hand-edit rule forbids, so the rule yields here instead.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },

  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'max-nested-callbacks': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
])

export default eslintConfig
