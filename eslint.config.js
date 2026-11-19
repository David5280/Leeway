import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { moneyText } from './eslint/moneyText.js'

// The project's code standards (CONTRIBUTING.md), enforced where a tool can.

/** Leeway's own rules, in eslint/. */
const leeway = { rules: { 'money-text': moneyText } }
export default tseslint.config(
  { ignores: ['**/dist', '**/coverage', '**/node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['e2e/**/*.{ts,mjs}', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-nested-ternary': 'error',
      'no-console': 'error',
      // Small files stay easy to read; split by responsibility before this trips.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      complexity: ['error', 15],
      // Plain, predictable control flow and no surprises in what a value is.
      'no-else-return': ['error', { allowElseIf: false }],
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-return': 'error',
      'no-param-reassign': 'error',
      'no-implicit-coercion': 'error',
      'prefer-template': 'error',
      'no-throw-literal': 'error',
    },
  },
  {
    // One way to show money (web/src/lib/money.ts and <Money>), so every
    // screen reads amounts alike: no number formatting of its own, and no
    // amount dropped into the page as bare text.
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { leeway },
    ignores: [
      'web/src/lib/money.ts',
      'web/src/components/design/Money.tsx',
      'web/src/**/*.test.{ts,tsx}',
      'web/src/test/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
          message: 'Format money in web/src/lib/money.ts and show it with <Money>.',
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: 'Round with Math.round, or format money in web/src/lib/money.ts.',
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'] Property[key.name='currency']",
          message: 'Format money in web/src/lib/money.ts and show it with <Money>.',
        },
      ],
      // A formatted amount reaching the page, however it gets there (eslint/moneyText.js).
      'leeway/money-text': 'error',
    },
  },
  {
    // Command-line scripts talk to the person running them.
    files: ['server/src/cli/**', 'server/src/db/migrate-cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests read best as one story per file.
    files: ['**/test/**', '**/*.test.{ts,tsx}'],
    rules: { 'max-lines': 'off' },
  },
)
