import { describe, expect, it } from 'vitest'
import { closeOutOf, IDEAS, LINES, OVER_BUDGET, planOf, UNDER_BUDGET } from '../../test/playbook'
import { mathSentence } from '../drill'
import { closeOutDrill, planDrill, suggestionsDrill } from './playbook'

const date = (iso: string) => iso
const money = (cents: number) => `$${cents / 100}`

describe('closeOutDrill', () => {
  it('takes what was spent from the budget, and flags a budget that went over', () => {
    const drill = closeOutDrill(closeOutOf(OVER_BUDGET), 'Oct 31 to Nov 13', money)
    expect(drill.figure).toEqual({ cents: 3_600, tone: 'warn' })
    expect(mathSentence(drill.math, money)).toBe(
      'Over budget by $36 = Budgeted $274 minus spent $310',
    )
    expect(drill.items?.rows[1]).toMatchObject({
      label: 'Dining',
      detail: 'Spent $120 of $74',
      value: { cents: -4_600, tone: 'warn' },
    })
  })
})

describe('suggestionsDrill', () => {
  it('shares the leftover out over the ideas, with what is still free', () => {
    const drill = suggestionsDrill(IDEAS, closeOutOf(UNDER_BUDGET).leftoverCents + 1_000)
    expect(mathSentence(drill.math, money)).toBe(
      'Still free $10 = Left over $54 minus Emergency fund $30 minus New laptop $14',
    )
  })
})

describe('planDrill', () => {
  it('takes bills and set-asides from the paycheck, marking an overdue bill', () => {
    const overdue = { ...LINES[0]!, overdue: true }
    const drill = planDrill(planOf([overdue, ...LINES.slice(1)]), date)
    expect(drill.figure).toEqual({ cents: 69_000, tone: 'neutral' })
    expect(mathSentence(drill.math, money)).toBe(
      'Left for everyday spending $690 = Paycheck $2100 minus bills before payday $1260 minus set aside $150',
    )
    expect(drill.items?.rows.map((row) => row.detail)).toEqual([
      'Bill, overdue',
      'Bill, due 2026-11-22',
      'Goal or trip',
      'Yearly cost',
    ])
    expect(drill.items?.rows[0]?.value).toEqual({ cents: 120_000, tone: 'warn' })
  })

  it('shows a paycheck that does not cover everything in amber', () => {
    const drill = planDrill(planOf(LINES, 100_000), date)
    expect(drill.figure).toEqual({ cents: -41_000, tone: 'warn' })
  })

  it('falls back to safe to spend while pay is unknown, with nothing to list', () => {
    const drill = planDrill(planOf([], null), date)
    expect(drill.figure).toEqual({ cents: 45_000 })
    expect(drill.math.note).toMatch(/Add your pay/)
    expect(drill.items).toBeUndefined()
  })
})
