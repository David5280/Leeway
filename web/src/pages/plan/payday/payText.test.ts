import { describe, expect, it } from 'vitest'
import { noPay, payView } from '../../../test/pay'
import { isEstimate, payerText, sourceNote } from './payText'

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
})
