import { describe, expect, it } from 'vitest'
import { noPay, payView } from '../../../test/pay'
import { cadenceLabel, isEstimate, payerText, sourceNote } from './payText'

describe('pay words', () => {
  it('names no payer when nobody is paying', () => {
    expect(payerText(noPay)).toBeNull()
  })

  it("names a payroll paid in a person's name as your employer", () => {
    expect(payerText(payView([{ name: 'JANE DOE DIR DEP' }]))).toBe('your employer')
    expect(payerText(payView())).toBe('Acme Corp')
  })

  it('calls one paycheck an estimate, and says what more paychecks were worked out from', () => {
    const once = payView([{ count: 1 }])
    expect(sourceNote(once, once.pay!)).toMatch(/^An estimate from one paycheck so far/)
    expect(isEstimate(once, once.pay!)).toBe(true)
    const many = payView()
    expect(sourceNote(many, many.pay!)).toBe(
      'Worked out from 6 paychecks. Money from people, refunds and transfers never count as pay.',
    )
    // Six paychecks two weeks apart settle it, though the owner has said nothing yet.
    expect(isEstimate(many, many.pay!)).toBe(false)
  })

  it('calls paydays that fit two schedules an estimate, however many', () => {
    const view = payView([{ count: 3, every: 15, last: '2026-11-13' }])
    expect(view.found!.employers[0]!.estimate).toBe(true)
    expect(sourceNote(view, view.pay!)).toMatch(/^An estimate from 3 paychecks so far/)
    expect(isEstimate(view, view.pay!)).toBe(true)
  })

  it("goes by the main job's paychecks, saying a second job's guess apart", () => {
    const view = payView([{}, { name: 'GIG PAYOUT', cents: 40_000, count: 1, last: '2026-11-16' }])
    expect(view.pay!.estimate).toBe(true)
    expect(sourceNote(view, view.pay!)).toBe(
      "Worked out from 6 paychecks. Money from people, refunds and transfers never count as pay. A second job's pay is an estimate until more of its paychecks land.",
    )
    expect(isEstimate(view, view.pay!)).toBe(false)
  })

  it('says when the owner confirmed it', () => {
    const view = payView([{}], { confirmed: true })
    expect(sourceNote(view, view.pay!)).toBe('You said this looks right.')
    expect(isEstimate(view, view.pay!)).toBe(false)
  })
  it('says when the paychecks no longer show what the owner confirmed', () => {
    const view = payView()
    const stale = { ...view, found: { ...view.found!, confirmationStale: true } }
    expect(sourceNote(stale, stale.pay!)).toBe(
      'Your paychecks changed since you said this looked right. This is what they show now.',
    )
  })

  it("keeps a second job's guess an estimate when only the main job is confirmed", () => {
    const view = payView(
      [{}, { name: 'GIG PAYOUT', cents: 40_000, count: 1, last: '2026-11-16' }],
      {
        confirmed: true,
      },
    )
    expect(view.found!.confirmed).toBe(true)
    expect(view.found!.employers[1]!.estimate).toBe(true)
    // The main job's paycheck and payday are settled, so no Estimate label on them.
    expect(view.pay).toMatchObject({ source: 'confirmed', paycheckCents: 210_000 })
    expect(isEstimate(view, view.pay!)).toBe(false)
    expect(sourceNote(view, view.pay!)).toBe(
      "You said this looks right. A second job's pay is an estimate until more of its paychecks land.",
    )
  })

  it('says the pay entered stands beside jobs still paying when its own job stopped', () => {
    const view = payView([{ name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }], {
      override: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' },
      forStoppedJob: true,
    })
    expect(view.yours!.jobStopped).toBe(true)
    expect(sourceNote(view, view.pay!)).toBe(
      'The job you entered pay for has stopped paying. Your pay still counts, beside any job still paying, until you update or remove it.',
    )
  })

  it('says the pay entered counts beside every job once saved that way', () => {
    const view = payView([{ name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }], {
      override: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' },
      besideJobs: true,
    })
    expect(view.yours).toMatchObject({ jobStopped: false, besideJobs: true })
    expect(view.found!.employers[0]!.replaced).toBe(false)
    expect(sourceNote(view, view.pay!)).toBe(
      'The pay you entered. Leeway counts it beside the pay your paychecks show.',
    )
  })

  it('labels a cadence said alone', () => {
    expect(cadenceLabel('biweek')).toBe('Every 2 weeks')
    expect(cadenceLabel('semimonth')).toBe('Twice a month')
  })
})
