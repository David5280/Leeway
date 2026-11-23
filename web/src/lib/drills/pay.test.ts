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
    const view = payView()
    const drill = drillOf(view)
    expect(drill.figure).toEqual({ cents: 210_000, tone: 'in' })
    expect(mathSentence(drill.math, money)).toBe(
      'About a month $4565.63 = One paycheck $2100 and Paychecks a year, over 12 months 26.1',
    )
    expect(drill.items?.rows).toEqual([
      {
        key: view.found!.employers[0]!.id,
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

  it('tells employers apart by id, calling one in a person’s name Your employer', () => {
    const view = payView([
      { name: 'JANE DOE DIR DEP' },
      { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' },
    ])
    const rows = drillOf(view).items!.rows
    expect(rows.map((row) => row.label)).toEqual(['Your employer', 'Side Gig'])
    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
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
  it('adds a second job to the owner’s own pay, never counting it as more paychecks', () => {
    const view = payView(
      [{}, { name: 'GIG PAYOUT', cents: 40_000, every: 7, last: '2026-11-16' }],
      {
        override: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' },
      },
    )
    const drill = drillOf(view)
    // Weekly pay is 52.2 paychecks a year, about $4,348 a month, beside the gig's own month.
    expect(drill.math.terms.map((term) => [term.label, term.value])).toEqual([
      ['Your pay, a month', { cents: 434_821 }],
      ['Side Gig, a month', { cents: view.found!.employers[1]!.monthlyCents }],
    ])
    expect(drill.math.result.value).toEqual({
      cents: 434_821 + view.found!.employers[1]!.monthlyCents,
      tone: 'in',
    })
    // Only the second job is listed: the owner's own pay is in place of the first.
    expect(drill.items?.rows.map((row) => row.label)).toEqual(['Side Gig'])
  })
})
