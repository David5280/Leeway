// What a typical budget period leaves over to save (domain/surplus.ts): a
// typical month of pay less spending, in the period's terms, and nothing
// while there is no pay or too little history to go on.

import { describe, expect, it } from 'vitest'
import { settingsSchema } from '../src/domain/settings.js'
import { surplusPerPeriod } from '../src/domain/surplus.js'

const MONTHLY = settingsSchema.parse({})
const BIWEEKLY = settingsSchema.parse({
  period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
})

describe('surplusPerPeriod', () => {
  it('is pay less spending, a month at a time or a paycheck at a time', () => {
    const month = { incomeCents: 520_000, spendingCents: 390_000 }
    expect(surplusPerPeriod(month, MONTHLY)).toBe(130_000)
    // Twelve months of $1,300 over a year's 26.09 paychecks (365.25 days over 14): about $598 each.
    expect(surplusPerPeriod(month, BIWEEKLY)).toBe(59_795)
  })

  it('goes below zero when spending outruns pay, for the plan to read as nothing to spare', () => {
    expect(surplusPerPeriod({ incomeCents: 300_000, spendingCents: 350_000 }, MONTHLY)).toBe(
      -50_000,
    )
  })

  it('is unknown with no employer paying or too little history', () => {
    expect(surplusPerPeriod({ incomeCents: null, spendingCents: 390_000 }, MONTHLY)).toBeNull()
    expect(surplusPerPeriod({ incomeCents: 520_000, spendingCents: null }, MONTHLY)).toBeNull()
  })
})
