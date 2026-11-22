// The drill-down behind cash that could earn more: the math adds up to the
// figure shown, to the cent, with the rounding as its own row, and a $0
// card balance left out so the math stays short.

import { describe, expect, it } from 'vitest'
import { checkIdleCash, type IdleCashInputs } from '../idleCash'
import { mathSentence, type DrillMath } from '../drill'
import { formatMoney } from '../money'
import { IDLE_CASH_TITLE, idleCashDrill } from './idleCash'

const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })

/** $8,059.99 in checking, $1,200 of bills, $400 owed on a card, $50 a day for 10 days. */
const facts: IdleCashInputs = {
  checkingCents: 805_999,
  billsCents: 120_000,
  cardsOwedCents: 40_000,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-11-27',
  paydayKnown: true,
  overdrawn: false,
  tight: false,
}

/** The terms worked through in order, as the sheet draws them. */
function total(math: DrillMath): number {
  return math.terms.reduce((sum, term) => {
    const cents = 'cents' in term.value ? term.value.cents : 0
    return term.op === 'minus' ? sum - cents : sum + cents
  }, 0)
}

describe('idleCashDrill', () => {
  it('names itself as the card does, and adds up to the figure, rounding included', () => {
    const drill = idleCashDrill(checkIdleCash(facts), (iso) => iso)
    expect(drill.title).toBe(IDLE_CASH_TITLE)
    expect(drill.title).toBe('Cash that could earn more')
    expect(drill.figure).toEqual({ cents: 520_000 })
    expect(mathSentence(drill.math, money)).toBe(
      'Could sit in savings $5,200 = In checking $8,059 minus bills due by payday $1,200 minus typical spending until payday $500 minus credit cards owed $400 minus a cushion kept for surprises $700 minus rounded down $59',
    )
    expect(total(drill.math)).toBe(520_000)
  })

  it('leaves out a card balance and a rounding of $0, and still adds up', () => {
    const drill = idleCashDrill(
      checkIdleCash({ ...facts, checkingCents: 800_000, cardsOwedCents: 0 }),
      (iso) => iso,
    )
    const labels = drill.math.terms.map((term) => term.label)
    expect(labels).not.toContain('credit cards owed')
    expect(labels).not.toContain('rounded down')
    expect(total(drill.math)).toBe(560_000)
  })

  it('says the rate is assumed, how checking is counted, and that Leeway never moves money', () => {
    const drill = idleCashDrill(checkIdleCash(facts), (iso) => iso)
    expect(drill.subtitle).toBe('Until payday, 2026-11-27')
    expect(drill.math.note).toContain('an overdraft line is never counted as cash')
    expect(drill.math.note).toContain('since checking pays them')
    expect(drill.math.note).toContain('leaves bill payments out')
    expect(drill.math.note).toContain('assumed 4% APY')
    expect(drill.math.note).toContain('Leeway never moves money')
    expect(drill.items!.title).toBe('What it could earn at an assumed 4% APY')
    // $5,200 at 4% is $208 a year, about $17 a month.
    expect(drill.items!.rows.map((row) => row.value)).toEqual([
      { cents: 20_800, tone: 'in' },
      { cents: 1_733, tone: 'in' },
    ])
  })
})
