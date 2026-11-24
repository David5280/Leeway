import { describe, expect, it } from 'vitest'
import type { AccountsView } from '../../api/client'
import { account, transaction } from '../../test/fake'
import { mathSentence, trendDescription } from '../drill'
import { money as formatMoney } from '../money'
import { accountDrill, allAccountsDrill, averageOf, balanceTrend, selectionDrill } from './accounts'
import { earlierPeriods, flowsDrill, leftOver, spendingDrill, usualOut } from './accountView'
import { worthPoint } from '../../test/worth'

/** Whole dollars, as the app shows amounts in drill-downs. */
const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })
const said = (drill: { math: Parameters<typeof mathSentence>[0] }) =>
  mathSentence(drill.math, money)
const range = (start: string, end: string) => `${start} to ${end}`

const checking = account({ id: 'k', name: 'Everyday', subtype: 'checking', balanceCents: 250000 })
const card = account({
  id: 'c',
  name: 'Travel card',
  type: 'credit',
  balanceCents: 37000,
  creditLimitCents: 100000,
})
const week = [100, 110, 120, 130, 140, 150, 160].map((dollars) => dollars * 100)

describe('balanceTrend and averageOf', () => {
  it('dates daily balances back from today, and needs two of them', () => {
    expect(balanceTrend([100, 200, 300], '2026-11-17', 'Everyday')).toEqual({
      points: [
        { date: '2026-11-15', cents: 100 },
        { date: '2026-11-16', cents: 200 },
        { date: '2026-11-17', cents: 300 },
      ],
      label: 'Balance over the last 3 days',
      description: "Everyday's balance each day for the last 3 days, today last.",
    })
    expect(balanceTrend([100], '2026-11-17', 'Everyday')).toBeUndefined()
  })

  it('carries where the balance should be, said for screen readers too', () => {
    const level = { cents: 30000, label: 'Under 30% of the limit' }
    const trend = balanceTrend([100, 200], '2026-11-17', 'Travel card', level)!
    expect(trend.reference).toEqual(level)
    expect(trendDescription(trend, money)).toBe(
      "Travel card's balance each day for the last 2 days, today last. The dashed line marks where it should be (Under 30% of the limit, $300).",
    )
    expect(trendDescription(balanceTrend([1, 2], '2026-11-17', 'Everyday')!, money)).toBe(
      "Everyday's balance each day for the last 2 days, today last.",
    )
  })

  it('averages balances to the cent, with none to average', () => {
    expect(averageOf([100, 201])).toBe(151)
    expect(averageOf([])).toBeNull()
  })
})

describe('accountDrill', () => {
  it('takes what a card owes from its limit, and notes how much of it is used', () => {
    const drill = accountDrill(card, { today: '2026-11-17' })
    expect(said(drill)).toBe('Credit left to use $630 = Credit limit $1,000 minus owed now $370')
    expect(drill.math.note).toBe('Using 37% of the limit. Under 30% is kinder to a credit score.')
    expect(drill.more).toEqual({ to: '/spending/activity?account=c', label: 'See all activity' })
  })

  it('leaves the note out for a card with no balance read yet', () => {
    const blank = { ...card, balanceCents: null }
    expect(accountDrill(blank, { today: '2026-11-17' }).math.note).toBeUndefined()
  })

  it('takes pending charges from a bank balance to what is available', () => {
    const pending = { ...checking, availableCents: 240000 }
    expect(said(accountDrill(pending, { today: '2026-11-17' }))).toBe(
      'Available now $2,400 = Balance at the bank $2,500 minus held for pending charges $100',
    )
    const owing = { ...card, creditLimitCents: null, availableCents: 30000 }
    expect(accountDrill(owing, { today: '2026-11-17' }).math.result.label).toBe(
      'Owed after pending',
    )
  })

  it('shows a plain balance, red when overdrawn, and says when it is kept by hand', () => {
    const short = { ...checking, balanceCents: -14210, manual: true }
    const drill = accountDrill(short, { today: '2026-11-17' })
    expect(drill.math.result).toEqual({
      label: 'Balance',
      value: { cents: -14210, tone: 'problem' },
    })
    expect(drill.figure).toEqual({ cents: -14210, tone: 'problem' })
    expect(drill.math.note).toBe('You keep this balance up to date by hand.')
    const loan = account({ id: 'l', name: 'Loan', type: 'loan', balanceCents: 500000 })
    expect(accountDrill(loan, { today: '2026-11-17' }).math.result.label).toBe('Owed')
  })

  it('compares the balance with its average once there is a week of it', () => {
    const drill = accountDrill(checking, { balances: week, today: '2026-11-17' })
    expect(drill.usual).toEqual({
      currentCents: 250000,
      usualCents: 13000,
      goodWhen: 'up',
      basis: 'its 7-day average',
    })
    // A card's balance is owed, so lower is better.
    expect(accountDrill(card, { balances: week, today: '2026-11-17' }).usual?.goodWhen).toBe('down')
    expect(accountDrill(checking, { balances: week.slice(1), today: '2026-11-17' }).usual).toBe(
      undefined,
    )
  })

  it('draws where a card should stay on its trend', () => {
    const level = { cents: 30000, label: 'Under 30% of the limit' }
    const drill = accountDrill(card, { balances: week, today: '2026-11-17', reference: level })
    expect(drill.trend?.reference).toEqual(level)
  })

  it('lists recent activity dated in words, each opening Activity on this account', () => {
    const tx = transaction({ id: 't', date: '2026-11-16', name: 'MARKET', amountCents: 4210 })
    const words = (iso: string) => (iso === '2026-11-16' ? 'Nov 16' : iso)
    expect(
      accountDrill(checking, { recent: [tx], today: '2026-11-17', date: words }).items!.rows[0]!
        .detail,
    ).toBe('Nov 16')
    const drill = accountDrill(checking, { recent: [tx], today: '2026-11-17' })
    expect(drill.items!.rows).toEqual([
      {
        key: 't',
        label: 'Market',
        detail: '2026-11-16',
        value: { cents: 4210, sign: 'transaction' },
        to: '/spending/activity?account=k',
      },
    ])
  })
})

describe('allAccountsDrill and selectionDrill', () => {
  const hidden = account({ id: 'h', name: 'Old', hidden: true, balanceCents: 99900 })
  const empty = account({ id: 'e', name: 'New', balanceCents: null })

  it('adds up the counted accounts, leaving out ignored ones, with net worth as the trend', () => {
    const drill = allAccountsDrill([checking, card, hidden, empty], {
      history: [worthPoint('2026-10-01', 100), worthPoint('2026-11-01', 200)],
    } as Parameters<typeof allAccountsDrill>[1])
    expect(said(drill)).toBe(
      'Together $2,130 = Owned in these accounts $2,500 minus owed on cards and loans $370',
    )
    expect(drill.trend?.points).toHaveLength(2)
    expect(drill.items!.rows.map((row) => [row.label, row.value])).toEqual([
      ['Everyday', { cents: 250000, tone: undefined }],
      ['Travel card', { cents: 37000, tone: undefined }],
      ['New', { text: 'No balance' }],
    ])
  })

  it('has no trend without net worth history, and reads a negative total in red', () => {
    const short = { ...checking, balanceCents: -5000 }
    const drill = allAccountsDrill([short])
    expect(drill.trend).toBeUndefined()
    expect(drill.math.result.value).toEqual({ cents: -5000, tone: 'problem' })
    expect(drill.items!.rows[0]!.value).toEqual({ cents: -5000, tone: 'problem' })
  })

  it('adds up a pick, named by how many', () => {
    expect(selectionDrill([checking]).title).toBe('1 account together')
    expect(selectionDrill([checking, card]).title).toBe('2 accounts together')
  })
})

describe('flowsDrill', () => {
  const october = { start: '2026-10-01', end: '2026-10-31', inCents: 300000, outCents: 280000 }
  const november = { start: '2026-11-01', end: '2026-11-30', inCents: 250000, outCents: 120000 }

  it('takes money out from money in, against the average of the earlier periods', () => {
    const drill = flowsDrill([october, november], range, money)!
    expect(said(drill)).toBe('Left over so far $1,300 = Money in $2,500 minus money out $1,200')
    expect(drill.figure).toEqual({ cents: 130000, sign: 'change', tone: 'in' })
    expect(drill.usual).toMatchObject({ currentCents: 120000, usualCents: 280000, subject: 'out' })
    expect(drill.items!.rows.map((row) => row.label)).toEqual([
      '2026-11-01 to 2026-11-30, so far',
      '2026-10-01 to 2026-10-31',
    ])
  })

  it('has no usual with one period, no color when more went out, and nothing with none', () => {
    const drill = flowsDrill([{ ...november, outCents: 300000 }], range, money)!
    expect(drill.usual).toBeUndefined()
    expect(drill.figure).toEqual({ cents: -50000, sign: 'change', tone: undefined })
    expect(flowsDrill([], range, money)).toBeNull()
    expect(leftOver(november)).toBe(130000)
    expect(usualOut([november])).toBeNull()
  })

  it('names one earlier period plainly, and several as their average', () => {
    expect(earlierPeriods(1)).toBe('the last period')
    expect(earlierPeriods(5)).toBe('the average of the last 5 periods')
  })
})

describe('spendingDrill', () => {
  const period = { start: '2026-11-01', end: '2026-11-30' }
  const spent = (name: string, cents: number, id: string | null = name) =>
    ({ categoryId: id, name, color: null, spentCents: cents }) as AccountsView['spending'][number]

  it('names the four biggest and sums the rest, each opening its category', () => {
    const rows = [
      spent('Rent', 180000),
      spent('Groceries', 40000),
      spent('Dining', 20000),
      spent('Gas', 9000),
      spent('Fun', 5000),
      spent('Needs a category', 1000, null),
    ]
    const drill = spendingDrill(rows, period, range)
    expect(said(drill)).toBe(
      'Spent this period $2,550 = Rent $1,800 plus Groceries $400 plus Dining $200 plus Gas $90 plus everything else $60',
    )
    expect(drill.items!.rows.at(0)!.to).toBe('/spending/Rent')
    expect(drill.items!.rows.at(-1)!.to).toBe('/spending/activity?category=uncategorized')
  })

  it('says when nothing was spent, with no categories to list', () => {
    const drill = spendingDrill([], period, range)
    expect(said(drill)).toBe('Spent this period $0 = No spending yet $0')
    expect(drill.items).toBeUndefined()
  })
})
