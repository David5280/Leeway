import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { moneyText } from './eslint/moneyText.js'

// A <Route> path that is neither the catch-all "*" nor a name from routes.ts
// (ROUTES, SCREEN_ROUTES or CONNECT_ROUTES).
const ROUTE_PATH_NOT_FROM_ROUTES = [
  "JSXOpeningElement[name.name='Route'] > JSXAttribute[name.name='path']",
  ":not([value.value='*'])",
  ":not([value.expression.type='MemberExpression'][value.expression.object.name=/^(SCREEN_|CONNECT_)?ROUTES$/])",
].join('')

/**
 * Every address the router answers lives in web/src/routes.ts, where the
 * phone layout guard finds it. A path written straight onto a <Route> would
 * reach the app unguarded, so only the catch-all "*" may be literal.
 */
const ROUTE_SYNTAX = [
  {
    selector: ROUTE_PATH_NOT_FROM_ROUTES,
    message: 'Give <Route> a path from routes.ts (or "*"), so the phone layout guard covers it.',
  },
]

/** The two files where money is formatted and drawn; the money checks skip them. */
const MONEY_HOME = ['web/src/lib/money.ts', 'web/src/components/design/Money.tsx']

/** Number formatting outside lib/money.ts, which would let a screen write amounts its own way. */
const MONEY_SYNTAX = [
  {
    selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
    message: 'Format money in web/src/lib/money.ts and show it with <Money>.',
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message: 'Round with Math.round, or format money in web/src/lib/money.ts.',
  },
  {
    selector: "CallExpression[callee.property.name='toLocaleString'] Property[key.name='currency']",
    message: 'Format money in web/src/lib/money.ts and show it with <Money>.',
  },
]

/** Leeway's own rules, in eslint/. */
const leeway = { rules: { 'money-text': moneyText } }

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
    // Development scripts, like the sharded browser test runner, run in Node.
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The layout checks run inside the page (see e2e/layout.ts).
    files: ['e2e/layout/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The Scriptable widget runs as one plain script with Scriptable's globals.
    files: ['widget/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: Object.fromEntries(
        ['args', 'config', 'Keychain', 'Request', 'ListWidget', 'Color', 'Font', 'Alert', 'Script']
          .map((name) => [name, 'readonly'])
          .concat([['module', 'writable']]),
      ),
    },
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
    // amount dropped into the page as bare text. Routes are held here too,
    // since a later block setting the same rule would replace this one.
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { leeway },
    ignores: [...MONEY_HOME, 'web/src/**/*.test.{ts,tsx}', 'web/src/test/**'],
    rules: {
      'no-restricted-syntax': ['error', ...MONEY_SYNTAX, ...ROUTE_SYNTAX],
      // A formatted amount reaching the page, however it gets there (eslint/moneyText.js).
      'leeway/money-text': 'error',
    },
  },
  {
    // Where money is formatted and drawn, only the route check applies.
    files: MONEY_HOME,
    rules: { 'no-restricted-syntax': ['error', ...ROUTE_SYNTAX] },
  },
  {
    // Command-line scripts talk to the person running them.
    files: ['server/src/cli/**', 'server/src/db/migrate-cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Scriptable runs a single file, so the widget script cannot be split up.
    files: ['widget/leeway-widget.js'],
    rules: { 'max-lines': 'off' },
  },
  {
    // Tests read best as one story per file.
    files: ['**/test/**', '**/*.test.{ts,tsx}'],
    rules: { 'max-lines': 'off' },
  },
)
