import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// The project's code standards (CONTRIBUTING.md), enforced where a tool can.
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
