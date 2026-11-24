// The afford check's words alone: the summary, when saving gets there, and
// the goal "Save for it" starts.

import { describe, expect, it } from 'vitest'
import { affordPlan, checkOf } from '../../../../test/afford'
import { affordAnswer, goalDraftFor, whenText } from './affordText'

const money = (cents: number) => `$${cents / 100}`
const date = (iso: string) => iso

describe('afford words', () => {
  it('fits today with no date to wait for and nothing to save', () => {
    const plan = affordPlan(checkOf(5_000, 'yes', ['It fits.']))
    expect(
      affordAnswer({ name: ' Lamp ', amountCents: 5_000 }, plan, money, date, 'month'),
    ).toEqual({
      verdict: 'Yes.',
      tone: 'good',
      summary: 'Lamp at $50 fits.',
      reasons: ['It fits.'],
      when: null,
      saveFor: false,
    })
  })

  it('says how much each period and by when, from the plan', () => {
    const plan = affordPlan(checkOf(120_000, 'no', ['Short.']))
    expect(whenText(plan, money, date, 'week')).toBe(
      'Putting aside $300 each week, you could buy it by 2027-02-28.',
    )
  })

  it('starts the goal from the trimmed name, the price and the saved-by day', () => {
    const plan = affordPlan(checkOf(120_000, 'no', ['Short.']))
    expect(goalDraftFor({ name: '  Road bike ', amountCents: 120_000 }, plan)).toEqual({
      name: 'Road bike',
      targetCents: 120_000,
      targetDate: '2027-02-28',
    })
  })
})
