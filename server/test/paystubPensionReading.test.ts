// A pension on a paystub, from what the reader is asked for to what reaches
// the pension: the prompt's word on pension labels, the plan name kept to
// name a new pension, and the figures mapped onto one. Every reading here is
// fixed, so nothing reaches a model.

import { describe, expect, it } from 'vitest'
import { PAYSTUB_PROMPT } from '../src/ai/paystubs.js'
import type { Paystub } from '../src/domain/paystubs/paystubs.js'
import { pensionPatchFrom, showsPensionContribution } from '../src/domain/paystubs/pension.js'
import { extractionFrom, type PaystubExtraction } from '../src/domain/paystubs/reading.js'
import { MAX_PLAN_NAME_LENGTH, REMOVED } from '../src/domain/paystubs/redact.js'
import { CITY_READING, confirmedPaystub, readLine } from './fixtures/paystub.js'

/** The city paystub as the reader might give it, with the pension line as printed. */
function readingWithPension(line: string, amount: string | null, planName: string | null) {
  return {
    ...CITY_READING,
    preTax: { ...CITY_READING.preTax, pension: readLine(amount, null, line) },
    employer: { ...CITY_READING.employer, pension: readLine(null) },
    pensionPlanName: planName,
  }
}

/** The paystub the owner confirms when they change nothing on the review screen. */
function confirmedFrom(extraction: PaystubExtraction): Paystub {
  const cents = (figures: Record<string, { cents: number | null }>) =>
    Object.fromEntries(Object.entries(figures).map(([field, figure]) => [field, figure.cents]))
  return confirmedPaystub({
    current: cents(extraction.current) as Paystub['current'],
    yearToDate: cents(extraction.yearToDate) as Paystub['yearToDate'],
  })
}

describe('the reader prompt', () => {
  it('names the usual pension labels as the pension, never as a 401(k), 457 or 403(b)', () => {
    for (const label of ['PERA', 'PERS', 'STRS', 'TRS', 'Pension', 'Retirement']) {
      expect(PAYSTUB_PROMPT).toContain(label)
    }
    expect(PAYSTUB_PROMPT).toContain('It is never a 401(k), 457 or 403(b)')
    // A plan's own defined-contribution side is not its pension either.
    expect(PAYSTUB_PROMPT).toContain('such as PERA 401(k) or PERA DC, is never the pension')
  })

  it("asks only for what the paystub prints, never a plan's rules from what the model knows", () => {
    expect(PAYSTUB_PROMPT).toContain('Report only what this paystub prints.')
    expect(PAYSTUB_PROMPT).toContain(
      "Never supply a plan's contribution rate, employer rate, multiplier or rules",
    )
  })

  it('asks for the plan name alone, and none without a pension contribution', () => {
    expect(PAYSTUB_PROMPT).toMatch(/pensionPlanName: the pension's plan name/)
    expect(PAYSTUB_PROMPT).toContain('Null when the stub shows no pension contribution.')
    expect(PAYSTUB_PROMPT).toContain("never a person's name or member number")
  })
})

describe('a pension line, read and mapped', () => {
  const LINES = [
    ['PERA Member 11.00% 422.95', 'PERA'],
    ['PERS EE Pre-tax 422.95', 'PERS'],
    ['CalSTRS Member 422.95', 'CalSTRS'],
    ['TRS 422.95', 'TRS'],
    ['Retirement PERA 422.95', 'PERA'],
    ['Pension 422.95', 'Pension'],
  ] as const

  it.each(LINES)(
    'maps a pension the reader gave from "%s" onto the pension, named %s',
    (line, name) => {
      const extraction = extractionFrom(readingWithPension(line, '422.95', name))
      expect(extraction.current.pension).toMatchObject({ cents: 42_295, source: line })
      expect(extraction.pensionPlanName).toBe(name)
      // Kept as the pension alone, never also as a workplace plan.
      for (const plan of ['plan401k', 'plan403b'] as const) {
        expect(extraction.current[plan].cents).toBeNull()
      }
      expect(pensionPatchFrom(confirmedFrom(extraction))).toEqual({
        contribution: { kind: 'amount', cents: 42_295 },
        grossPayCents: 384_500,
        payCadence: 'semimonth',
      })
    },
  )

  it('keeps no plan name without a pension contribution to name', () => {
    const extraction = extractionFrom(readingWithPension('PERA', null, 'PERA'))
    expect(extraction.pensionPlanName).toBeNull()
    expect(showsPensionContribution(confirmedFrom(extraction))).toBe(false)
  })

  it('takes identifiers out of a plan name, and keeps it short enough to name a pension', () => {
    const named = (planName: string | null) =>
      extractionFrom(readingWithPension('PERA 422.95', '422.95', planName)).pensionPlanName
    expect(named('PERA Employee ID 004417')).toBe('PERA')
    expect(named('PERA Member ID 4417')).toBe('PERA')
    expect(named('PERA Member # A1234')).toBe('PERA')
    expect(named('PERA Member 11.00% 422.95')).toBe('PERA')
    expect(named('Colorado PERA EE Pre-tax $422.95')).toBe('Colorado PERA')
    expect(named('Member 422.95')).toBeNull()
    expect(named('PERA Mbr 1234')).toBe('PERA')
    expect(named('PERA No. 4417')).toBe('PERA')
    expect(named('PERA ID: A12')).toBe('PERA')
    expect(named('PERA: 422.95')).toBe('PERA')
    expect(named('Colorado PERA 0044172')).toBe('Colorado PERA')
    expect(named(`${REMOVED}`)).toBeNull()
    expect(named('   ')).toBeNull()
    expect(named(null)).toBeNull()
    expect(named('P'.repeat(200))).toHaveLength(MAX_PLAN_NAME_LENGTH)
  })

  it('gives the employer share only when the paystub prints it, as a share of gross pay', () => {
    const paystub = confirmedPaystub()
    expect(pensionPatchFrom(paystub).employerContributionPercent).toBe(21.4)
    paystub.current = { ...paystub.current, grossPay: null }
    expect(pensionPatchFrom(paystub)).toEqual({
      contribution: { kind: 'amount', cents: 42_295 },
      payCadence: 'semimonth',
    })
  })
})

describe('showsPensionContribution', () => {
  it('needs more than nothing paid into the pension this period', () => {
    const withPension = (pension: number | null) => {
      const paystub = confirmedPaystub()
      paystub.current = { ...paystub.current, pension }
      return showsPensionContribution(paystub)
    }
    expect(withPension(42_295)).toBe(true)
    expect(withPension(0)).toBe(false)
    expect(withPension(null)).toBe(false)
  })
})
