// The lint rule that keeps amounts on screen drawn by <Money> (eslint.config.js):
// every way a formatted amount could slip into the page is caught, and the
// places that must spell an amount out as text are left alone.

import { resolve } from 'node:path'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

/** The repository, where eslint.config.js lives, with a trailing slash. */
const ROOT = `${resolve(__dirname, '../..')}/`
const RULE_MESSAGE = 'Show an amount with <Money cents={...} />, not as formatted text.'

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT })
})

/** How many times the rule fires on a component file holding this JSX. */
async function hits(jsx: string, file = 'web/src/pages/Fixture.tsx'): Promise<number> {
  const code = `
    declare const money: (cents: number) => string
    declare const exact: (cents: number) => string
    declare const compactMoney: (cents: number, options: object) => string
    declare const app: { money: (cents: number) => string }
    declare const Pill: (props: { label: string }) => null
    declare const shown: boolean
    export function Fixture() {
      return ${jsx}
    }
  `
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${file}` })
  // A fixture that fails to parse would pass every test, so none may.
  expect(result!.messages.filter((message) => message.fatal)).toEqual([])
  return result!.messages.filter((message) => message.message === RULE_MESSAGE).length
}

describe('the money lint rule', () => {
  it.each([
    ['a child', '<p>{money(500)}</p>'],
    ['a ternary', '<p>{shown ? money(500) : null}</p>'],
    ['an &&', '<p>{shown && exact(500)}</p>'],
    ['a template string', '<p>{`Left ${money(500)}`}</p>'],
    ['a prop', '<Pill label={money(500)} />'],
    ['a prop built from a template', '<Pill label={`${money(500)} left`} />'],
    ['a method call', '<p>{app.money(500)}</p>'],
    ['a short amount', '<p>{compactMoney(500, {})}</p>'],
    ['a list', '<ul>{[1, 2].map((cents) => <li key={cents}>{money(cents)}</li>)}</ul>'],
  ])('catches an amount formatted in %s', async (_form, jsx) => {
    expect(await hits(jsx)).toBe(1)
  })

  it.each([
    ['an aria-label', '<p aria-label={`Spent ${money(500)}`} />'],
    ['a title', '<p title={money(500)} />'],
    ["a chart's description", '<Pill label="Chart" description={money(500)} />'],
  ])('leaves an amount spelled out in %s, which only a screen reader reads', async (_f, jsx) => {
    expect(await hits(jsx)).toBe(0)
  })

  it('leaves amounts formatted outside the page alone', async () => {
    expect(await hits('money(500)')).toBe(0)
  })

  it('leaves <Money> itself alone, which is where amounts are drawn', async () => {
    expect(await hits('<p>{money(500)}</p>', 'web/src/components/design/Money.tsx')).toBe(0)
  })
})
