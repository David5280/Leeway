// Money in against money out, month by month, and the drill-down behind it.

import { describe, expect, it } from 'vitest'
import { mathSentence } from './drill'
import { flowsDrill } from './drills/flows'
import { month, totalsOf } from '../test/months'
import { flowsFrom, flowsHeadline, overspent } from './flows'
import { formatMoney } from './money'

const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })

describe('flowsFrom', () => {
  it('has no usual month before there is any data', () => {
    expect(flowsFrom(totalsOf([]))).toEqual({ months: [], usual: null })
    expect(flowsHeadline(flowsFrom(totalsOf([])))).toBeNull()
  })

  it('shows the running month but never averages it', () => {
    const flows = flowsFrom(totalsOf([month('2026-11-01', 300000, 120000, true)]))
    expect(flows.months[0]).toMatchObject({ keptCents: 180000, current: true })
    expect(flows.usual).toBeNull()
    expect(overspent(flows.months[0]!)).toBe(false)
  })

  it('averages the finished months with money moving, leaving off empty ones from before the bank history', () => {
    const flows = flowsFrom(
      totalsOf([
        month('2026-07-01', 0, 0),
        month('2026-08-01', 0, 0),
        month('2026-09-01', 300000, 100000),
        month('2026-10-01', 0, 0),
        month('2026-11-01', 0, 50000, true),
      ]),
    )
    // A gap inside the history stays on the chart; it just is not averaged.
    expect(flows.months.map((one) => one.start)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
    expect(
      flowsFrom(totalsOf([month('2026-10-01', 0, 0), month('2026-11-01', 0, 0, true)])).months,
    ).toHaveLength(1)
    expect(flows.usual).toEqual({
      incomeCents: 300000,
      spentCents: 100000,
      keptCents: 200000,
      count: 1,
    })
    expect(flowsHeadline(flows)).toEqual({ cents: 200000, words: 'kept a month, on average' })
    const two = flowsFrom(
      totalsOf([month('2026-09-01', 300000, 100000), month('2026-10-01', 300000, 200001)]),
    )
    expect(two.usual).toMatchObject({ spentCents: 150001, keptCents: 149999, count: 2 })
  })

  it('leaves off the month the bank history starts partway through', () => {
    const totals = [
      month('2026-08-01', 0, 0),
      // History from Sep 20: a third of a month of money is not a low month.
      month('2026-09-01', 100000, 20000),
      month('2026-10-01', 300000, 100000),
      month('2026-11-01', 0, 50000, true),
    ]
    const flows = flowsFrom(totalsOf(totals, '2026-09-20'))
    expect(flows.months.map((one) => one.start)).toEqual(['2026-10-01', '2026-11-01'])
    expect(flows.usual).toMatchObject({ incomeCents: 300000, count: 1 })
    // A history that starts on the first of a month covers it whole.
    expect(flowsFrom(totalsOf(totals, '2026-09-01')).usual).toMatchObject({ count: 2 })
    // A history that starts this month leaves only the running month.
    expect(flowsFrom(totalsOf(totals, '2026-11-05')).months).toHaveLength(1)
  })

  it('reads a month with more out than in as short, and a run of them as a problem', () => {
    const flows = flowsFrom(
      totalsOf([month('2026-09-01', 100000, 150000), month('2026-10-01', 0, 20000)]),
    )
    expect(flows.months.map(overspent)).toEqual([true, true])
    expect(flowsHeadline(flows)).toEqual({ cents: 35000, words: 'more out than in, a month' })
  })

  it('keeps refunds that outweigh spending as negative spending', () => {
    const flows = flowsFrom(totalsOf([month('2026-10-01', -5000, -20000)]))
    expect(flows.months[0]!.keptCents).toBe(15000)
    expect(flows.usual).toMatchObject({ incomeCents: -5000, spentCents: -20000 })
  })

  it('counts unfiled deposits as money in beside filed income', () => {
    // $2,000 filed pay and a $500 unfiled deposit: $2,500 came in.
    const flows = flowsFrom(totalsOf([month('2026-10-01', 200000, 100000, false, 50000)]))
    expect(flows.months[0]).toMatchObject({ incomeCents: 250000, keptCents: 150000 })
    // A month whose only money in is unfiled still starts the history.
    const only = flowsFrom(
      totalsOf([month('2026-09-01', 0, 0, false, 1000), month('2026-10-01', 0, 0)]),
    )
    expect(only.months).toHaveLength(2)
  })

  it('keeps huge amounts exact', () => {
    const huge = 900_000_000_000_00
    const flows = flowsFrom(totalsOf([month('2026-10-01', huge, huge - 1)]))
    expect(flows.usual!.keptCents).toBe(1)
  })
})

describe('flowsDrill', () => {
  const label = (iso: string) => iso.slice(0, 7)

  it('gives the usual month as the answer, the math, then each month newest first', () => {
    const flows = flowsFrom(
      totalsOf([
        month('2026-09-01', 300000, 100000),
        month('2026-10-01', 300000, 400000),
        month('2026-11-01', 0, 50000, true),
      ]),
    )
    const drill = flowsDrill(flows, label)
    expect(drill.subtitle).toBe('A usual month, from the last 2 finished months')
    expect(drill.figure).toEqual({ cents: 50000, tone: undefined })
    expect(mathSentence(drill.math, money)).toBe(
      'Kept each month $500 = Money in $3,000 minus money out $2,500',
    )
    expect(drill.items!.rows.map((row) => [row.label, row.detail, row.value])).toEqual([
      ['2026-11, so far', 'Short', { cents: 50000, tone: undefined }],
      ['2026-10', 'Short', { cents: 100000, tone: 'problem' }],
      ['2026-09', 'Kept', { cents: 200000, tone: undefined }],
    ])
    expect(drill.more).toEqual({ to: '/spending/activity', label: 'Open activity' })
  })

  it('says when no month has finished, and when a usual month runs short', () => {
    expect(flowsDrill(flowsFrom(totalsOf([])), label).subtitle).toBe('No finished month yet')
    const short = flowsDrill(flowsFrom(totalsOf([month('2026-10-01', 100000, 130000)])), label)
    expect(short.subtitle).toBe('A usual month, from the last finished month')
    expect(short.figure).toEqual({ cents: 30000, tone: 'problem' })
    expect(short.math.result.label).toBe('Short each month')
  })
})
