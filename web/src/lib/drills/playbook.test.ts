// The playbook's drill-downs: the leftover's math budget by budget, and the
// plan's math with every dollar's job.

import { describe, expect, it } from 'vitest'
import { planPaycheck } from '../../../../server/src/domain/playbook/plan'
import { closeOutOf, stepNeed, UNDER_BUDGET } from '../../test/playbook'
import { mathSentence } from '../drill'
import { closeOutDrill, planDrill } from './playbook'

const money = (cents: number) => `$${Math.round(cents / 100)}`
const date = (iso: string) => iso.slice(5)

describe('closeOutDrill', () => {
  it('takes spending from the budgets, each budget opening its own page', () => {
    const drill = closeOutDrill(closeOutOf(UNDER_BUDGET), 'Oct 30 to Nov 12', money)
    expect(drill).toMatchObject({ title: 'Left over', figure: { cents: 4_400, tone: 'in' } })
    expect(mathSentence(drill.math, money)).toBe('Left over $44 = Budgeted $274 minus spent $230')
    expect(drill.items!.rows.map((row) => [row.label, row.value, row.to])).toEqual([
      ['Groceries', { cents: 6_400, tone: 'neutral' }, '/budgets/cat-groceries'],
      ['Dining', { cents: -2_000, tone: 'warn' }, '/budgets/cat-dining'],
    ])
  })

  it('reads as over budget when spending ran over', () => {
    const over = closeOutOf([{ name: 'Dining', budgetCents: 9_000, spentCents: 13_000 }])
    const drill = closeOutDrill(over, 'Oct 30 to Nov 12', money)
    expect(drill).toMatchObject({ title: 'Over budget', figure: { cents: 4_000, tone: 'warn' } })
    expect(drill.math.result).toEqual({ label: 'Over budget by', value: { cents: 4_000 } })
  })
})

describe('planDrill', () => {
  const needs = [stepNeed('bills', [['Rent', 150_000, '2026-11-20']])]

  it('adds the leftover to the paycheck, and lists every item with its step', () => {
    const drill = planDrill(planPaycheck(210_000, 4_400, needs), date)
    expect(mathSentence(drill.math, money)).toBe(
      'To plan $2144 = Paycheck $2100 plus left over $44',
    )
    expect(drill.items!.rows.map((row) => [row.label, row.detail, row.value])).toEqual([
      ['Rent', 'Bills before payday, 11-20', { cents: 150_000 }],
      ['Anything still free', 'Savings', { cents: 64_400 }],
    ])
  })

  it('takes off what ran over, and has nothing to add with no leftover', () => {
    const over = planDrill(planPaycheck(210_000, -4_000, needs), date)
    expect(mathSentence(over.math, money)).toBe(
      'To plan $2060 = Paycheck $2100 minus over budget $40',
    )
    expect(planDrill(planPaycheck(210_000, 0, needs), date).math.terms).toHaveLength(1)
  })
})
