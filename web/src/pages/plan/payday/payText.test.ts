import { describe, expect, it } from 'vitest'
import { noPay, payView } from '../../../test/pay'
import { cadenceLabel, isEstimate, payerText, sourceNote } from './payText'

describe('pay words', () => {
  it('names no payer when nobody is paying', () => {
    expect(payerText(noPay)).toBeNull()
  })

  it('calls one paycheck an estimate, and says what more paychecks were worked out from', () => {
    const once = payView([{ count: 1 }])
    expect(sourceNote(once, once.pay!)).toMatch(/^An estimate from one paycheck so far/)
    const many = payView()
    expect(sourceNote(many, many.pay!)).toBe(
      'Worked out from 6 paychecks. Money from people, refunds and transfers never count as pay.',
    )
    expect(isEstimate(many.pay!)).toBe(true)
  })

  it('says when the owner confirmed it', () => {
    const view = payView([{}], { confirmed: true })
    expect(sourceNote(view, view.pay!)).toBe('You said this looks right.')
    expect(isEstimate(view.pay!)).toBe(false)
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
    expect(isEstimate(view.pay!)).toBe(false)
    expect(sourceNote(view, view.pay!)).toBe(
      "You said this looks right. A second job's pay is an estimate until more of its paychecks land.",
    )
  })

  it('labels a cadence said alone', () => {
    expect(cadenceLabel('biweek')).toBe('Every 2 weeks')
    expect(cadenceLabel('semimonth')).toBe('Twice a month')
  })
})
