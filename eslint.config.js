import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// A <Route> path that is neither the catch-all "*" nor a name from routes.ts
// (ROUTES, SCREEN_ROUTES or CONNECT_ROUTES).
const ROUTE_PATH_NOT_FROM_ROUTES = [
  "JSXOpeningElement[name.name='Route'] > JSXAttribute[name.name='path']",
  ":not([value.value='*'])",
  ":not([value.expression.type='MemberExpression'][value.expression.object.name=/^(SCREEN_|CONNECT_)?ROUTES$/])",
].join('')

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
    // The layout checks run inside the page (see e2e/layout.ts).
    files: ['e2e/layout/**/*.ts'],
    languageOptions: { globals: globals.browser },
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
    // Every address the router answers lives in web/src/routes.ts, where the
    // phone layout guard finds it. A path written straight onto a <Route>
    // would reach the app unguarded, so only the catch-all "*" may be literal.
    files: ['web/src/**/*.tsx'],
    ignores: ['web/src/test/**', 'web/src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ROUTE_PATH_NOT_FROM_ROUTES,
          message:
            'Give <Route> a path from routes.ts (or "*"), so the phone layout guard covers it.',
        },
      ],
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
