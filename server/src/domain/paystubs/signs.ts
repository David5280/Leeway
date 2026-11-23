// Which amounts a paystub marks with a sign its other lines of that kind do
// not carry. A stub marks deductions one way throughout, "(12.50)", "-12.50",
// "12.50-" or plain, often one way this period and another for the year, so
// a line marked against the rest is likely a refund or a reversal. Leeway
// reads every amount as positive and never subtracts, so such a line is only
// marked for the owner to check. Pay and earnings are never negative. Pure.

import { signOf, type Sign } from './amounts.js'
import type { HasLines } from './detail.js'
import { eachField, eachGroup, type CentsLine, type LineGroup } from './lines.js'
import type { PaystubReading, ReadLine } from './reading.js'

type Column = keyof CentsLine
const COLUMNS: readonly Column[] = ['current', 'yearToDate']

/** For each column of a line, whether its amount is marked against the rest. */
export type SignFlags = Record<Column, boolean>

/** The sign expected in each column, or null where the stub gives none more than the other. */
type Usual = Record<Column, Sign | null>

/** Pay and earnings are always plain. */
const PLAIN: Usual = { current: 'plus', yearToDate: 'plus' }

/** The groups taken out of pay, which a stub marks alike. The employer's lines are marked apart. */
const DEDUCTIONS: readonly LineGroup[] = ['taxes', 'preTax', 'postTax']

/** The sign most of these lines carry in each column; null on a tie, so every signed line is checked. */
function usualSign(lines: readonly ReadLine[]): Usual {
  return eachField(COLUMNS, (column) => {
    const signs = lines.map((line) => signOf(line[column]))
    const minus = signs.filter((sign) => sign === 'minus').length
    const plus = signs.filter((sign) => sign === 'plus').length
    if (minus === plus) return null
    return minus > plus ? 'minus' : 'plus'
  })
}

/** A line's columns marked other than expected. A mixed amount never matches. */
function flagsOf(line: ReadLine, usual: Usual): SignFlags {
  return eachField(COLUMNS, (column) => {
    const sign = signOf(line[column])
    return sign !== null && sign !== usual[column]
  })
}

/** Every line of a reading, with which of its columns are marked against the rest. */
export function signedAgainst(reading: PaystubReading): HasLines<SignFlags> {
  const linesOf = (group: LineGroup) => Object.values(reading[group]) as ReadLine[]
  const deductions = usualSign(DEDUCTIONS.flatMap(linesOf))
  const employer = usualSign(linesOf('employer'))
  const usualFor = (group: LineGroup): Usual => {
    if (group === 'earnings') return PLAIN
    return group === 'employer' ? employer : deductions
  }
  return {
    pay: { gross: flagsOf(reading.pay.gross, PLAIN), net: flagsOf(reading.pay.net, PLAIN) },
    ...eachGroup((group, line) =>
      flagsOf((reading[group] as Record<string, ReadLine>)[line]!, usualFor(group)),
    ),
  }
}
