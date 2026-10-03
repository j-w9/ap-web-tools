// Lint rules enforce correct use of TypeScript, not formatting (Prettier owns formatting).
// See docs/typescript-standard.md for the reasoning behind each rule.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      // Tools being ported in parallel; linted when they land.
      'apps/filter-review/**',
      'apps/magfit/**',
      'apps/hardware-report/**',

      '**/dist/**',
      '**/node_modules/**',
      'upstream/**',
      'scripts/**',
      '**/*.d.ts',
      'eslint.config.js',
      'vite.config.ts',
      'vitest.config.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // No escape hatches from the type system.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 }
      ],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' }],
      // `!` is allowed only on indexed access (`a[i]!`), where `noUncheckedIndexedAccess` cannot see
      // that a loop bound already proves the index valid. Anywhere else, narrow the value instead.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNonNullExpression:not([expression.type="MemberExpression"][expression.computed=true])',
          message: 'Non-null assertions are only allowed on indexed access. Narrow the value with a check instead.'
        },
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
          message: 'Double cast through `unknown` defeats type checking. Narrow the value or fix the type instead.'
        }
      ],

      // Make the compiler prove things.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Stylistic; would churn every `() => setState(x)` arrow for no safety gain.
      '@typescript-eslint/no-confusing-void-expression': 'off'
    }
  },
  {
    // Tests may poke at internals and use non-null assertions on known fixtures.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-support/**', '**/test-utils/**'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off'
    }
  }
)
