// The savings rate with and without what payroll takes before the bank sees
// it (savings/rate.ts): a workplace plan and the employer's match a
// confirmed paystub shows count on both sides of the rate, and every place
// that compares the rate with a target says they were counted. Pure.

import { describe, expect, it } from 'vitest'
import { retirementGap } from '../src/domain/playbook/facts.js'
import { savingsMeasures } from '../src/domain/profile/profile.js'
import type { BankContributions } from '../src/domain/savings/contributions.js'
import { countedNote, countingWords, type SavingsRate } from '../src/domain/savings/rate.js'
import { settingsSchema } from '../src/domain/settings.js'
import { monthRates } from '../src/domain/savingsRates.js'
import { emptyProfile } from './fixtures/profile.js'

/** 500.00 a month moved to savings at the bank. */
const BANK: BankContributions = {
  since: '2025-11-24',
  totalCents: { cash: 600_000, invested: 0 },
  monthlyCents: { cash: 50_000, invested: 0 },
  transferCount: 12,
}

/** The rate on 5,000.00 of take-home a month, with the payroll figures given. */
function rateWith(payroll: { planMonthlyCents?: number; matchMonthlyCents?: number } = {}) {
  const { monthly } = emptyProfile()
  return savingsMeasures({
    fundSavedCents: null,
    contributions: BANK,
    pensionMonthlyCents: null,
    ...payroll,
    monthly: { ...monthly, incomeCents: 500_000 },
    essentials: null,
    settings: settingsSchema.parse({}),
    today: '2026-11-24',
  }).savingsRate!
}

describe('the savings rate and payroll contributions', () => {
  it('counts only bank transfers when no payroll contribution is known', () => {
    const rate = rateWith()
    expect(rate.percent).toBe(10)
    expect(rate.payMonthlyCents).toBe(500_000)
    expect(countingWords(rate)).toBe('counting only bank transfers')
  })

  it('adds a 401(k) and the match to what is saved and to the pay it is a share of', () => {
    const rate = rateWith({ planMonthlyCents: 40_000, matchMonthlyCents: 20_000 })
    // 500 + 400 + 200 saved of 5,000 + 400 + 200: 1,100 of 5,600.
    expect(rate.savedMonthlyCents).toBe(110_000)
    expect(rate.payMonthlyCents).toBe(560_000)
    expect(rate.percent).toBe(20)
    expect(rate.sources.map((source) => source.label)).toEqual([
      'Transfers to savings',
      'Workplace plan contributions',
      'Employer match',
    ])
  })

  it('says the payroll contributions were counted wherever the rate is read', () => {
    const rate = rateWith({ planMonthlyCents: 40_000, matchMonthlyCents: 20_000 })
    expect(countingWords(rate)).toBe(
      "counting bank transfers, your workplace plan and your employer's match",
    )
    expect(countedNote(rate)).toMatch(/your paystub shows.*Your employer's match counts too\.$/)
    expect(countingWords(rateWith({ planMonthlyCents: 40_000 }))).toBe(
      'counting bank transfers and your workplace plan',
    )
  })
})

describe("the payday playbook's retirement idea", () => {
  const gap = (rate: SavingsRate) =>
    retirementGap({ savingsRate: rate, savingsRateTargetPercent: 25 }, 'month')

  it('counts a 401(k) taken from pay, so the nudge is smaller and says it was counted', () => {
    const bankOnly = gap(rateWith())!
    const withPayroll = gap(rateWith({ planMonthlyCents: 40_000, matchMonthlyCents: 20_000 }))!
    expect(bankOnly.counting).toBe('counting only bank transfers')
    expect(withPayroll.counting).toContain('your workplace plan')
    // 15 points short of 5,000.00 against 5 points short of 5,600.00.
    expect(bankOnly.cents).toBe(75_000)
    expect(withPayroll.cents).toBe(28_000)
  })
})

describe('the monthly history and the profile agree', () => {
  it("counts the match in a month's rate exactly as the profile's rate does", () => {
    const profile = rateWith({ planMonthlyCents: 40_000, matchMonthlyCents: 12_000 })
    // A finished month of the same pay, the same transfer and the same payroll streams.
    const [month] = monthRates(
      [
        {
          start: '2026-10-01',
          end: '2026-10-31',
          current: false,
          incomeCents: 500_000,
          spentCents: 0,
          unfiledInCents: 0,
          categories: [],
        },
      ],
      [
        {
          date: '2026-10-05',
          amountCents: 50_000,
          providerCategoryDetailed: 'TRANSFER_OUT_SAVINGS',
        },
      ],
      [
        { kind: 'plan', monthlyCents: 40_000, since: null },
        { kind: 'match', monthlyCents: 12_000, since: null },
      ],
    )
    expect(month).toMatchObject({
      percent: profile.percent,
      savedCents: profile.savedMonthlyCents,
      payCents: profile.payMonthlyCents,
    })
    // $500 + $400 + $120 saved, of $5,000 take-home plus the $520 from payroll.
    expect(month?.percent).toBe(18)
  })
})
