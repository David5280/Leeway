import { describe, expect, it } from 'vitest'
import { payView } from '../../test/pay'
import { mathSentence } from '../drill'
import { payDrill } from './pay'

const date = (iso: string) => iso
const money = (cents: number) => `$${cents / 100}`

function drillOf(view = payView()) {
  return payDrill(view, view.pay!, date)
}

describe('payDrill', () => {
  it('spreads one job’s paychecks over a month', () => {
    const drill = drillOf()
    expect(drill.figure).toEqual({ cents: 210_000, tone: 'in' })
    expect(mathSentence(drill.math, money)).toBe(
      'About a month $4565.63 = One paycheck $2100 and paychecks a year, over 12 months 26.1',
    )
    expect(drill.items?.rows).toEqual([
      {
        key: 'Acme Corp',
        label: 'Acme Corp',
        detail: 'Paid every 2 weeks, next 2026-11-27',
        value: { cents: 210_000 },
      },
    ])
  })

  it('adds up each job’s month when there are two', () => {
    const drill = drillOf(
      payView([{}, { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }]),
    )
    expect(drill.math.terms.map((term) => term.label)).toEqual([
      'Acme Corp, a month',
      'Side Gig, a month',
    ])
    expect(drill.math.terms[1]!.op).toBe('plus')
    expect(drill.items?.rows).toHaveLength(2)
  })

  it('takes the owner’s own pay alone, with no employers under it', () => {
    const view = payView([{}], {
      override: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' },
    })
    const drill = drillOf(view)
    expect(drill.math.terms[1]!.value).toEqual({ text: '52.2' })
    expect(drill.math.note).toMatch(/^The pay you entered/)
    expect(drill.items).toBeUndefined()
  })
})
