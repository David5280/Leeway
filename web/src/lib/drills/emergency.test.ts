import { describe, expect, it } from 'vitest'
import { essentials, EVERYDAY, fundChoice, fundView, offerView, RAINY } from '../../test/emergency'
import { mathSentence } from '../drill'
import { money as formatMoney } from '../money'
import { emergencyFundDrill, emergencyOfferDrill } from './emergency'

/** Whole dollars, as the app shows amounts in drill-downs. */
const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })
const said = (drill: { math: Parameters<typeof mathSentence>[0] }) =>
  mathSentence(drill.math, money)

describe('the emergency fund drill-down', () => {
  it('divides what it holds by a month of essentials, with the target it aims for', () => {
    const drill = emergencyFundDrill(fundView(), 'Emergency fund')
    expect(drill.title).toBe('Emergency fund')
    expect(drill.subtitle).toBe('1 month of essentials')
    expect(drill.figure).toEqual({ cents: 50_000 })
    expect(said(drill)).toBe(
      'Covers 0.2 months = Saved $500 divided by what Rent and Groceries cost a month $2,000',
    )
    expect(drill.math.note).toBe(
      'Counts every savings account. The target is 1 month of essentials.',
    )
  })

  it('lists the accounts it counts, linked to each, and leaves the uncounted ones out', () => {
    const drill = emergencyFundDrill(fundView(), 'Emergency fund')
    expect(drill.items).toEqual({
      title: 'Accounts it counts',
      rows: [
        {
          key: 'acct-rainy',
          label: 'Rainy Day',
          detail: 'Counted',
          value: { cents: 50_000 },
          to: '/accounts/acct-rainy',
        },
      ],
    })
  })

  it('shows an account another goal follows, and a marked one it cannot count, with why', () => {
    const accounts = [
      RAINY,
      EVERYDAY,
      fundChoice({
        id: 't',
        name: 'Savings',
        counted: false,
        leftOut: 'other_goal',
        otherGoal: 'Trip',
      }),
      fundChoice({
        id: 'h',
        name: 'Spare',
        counted: false,
        marked: true,
        leftOut: 'hidden',
        balanceCents: null,
      }),
    ]
    const drill = emergencyFundDrill(fundView({ counts: 'marked', accounts }), 'Cushion')
    expect(drill.items!.rows.map((row) => [row.label, row.detail, row.value])).toEqual([
      ['Rainy Day', 'Counted', { cents: 50_000 }],
      ['Savings', 'Trip follows it', { cents: 50_000 }],
      ['Spare', 'Hidden, so not counted', undefined],
    ])
  })

  it("says an owner's own target is theirs, in months as near as it comes", () => {
    const drill = emergencyFundDrill(fundView({ ownTarget: true, months: 2.5 }), 'Cushion')
    expect(drill.subtitle).toBe('About 2.5 months of essentials')
    expect(drill.math.note).toBe('Counts every savings account. The target is your own amount.')
  })

  it('shows what is left to the target while essentials are unknown', () => {
    const view = fundView({
      essentials: null,
      months: null,
      ownTarget: true,
      monthsCovered: null,
      targetCents: 300_000,
    })
    const drill = emergencyFundDrill(view, 'Rainy day')
    expect(drill.subtitle).toBe('Your own target')
    expect(said(drill)).toBe('To go $2,500 = Target $3,000 minus saved $500')
  })

  it('lists no accounts for a fund counted by hand', () => {
    const drill = emergencyFundDrill(fundView({ counts: 'hand' }), 'Rainy day')
    expect(drill.items).toBeUndefined()
    expect(drill.math.note).toMatch(/^Counts what you add by hand\./)
  })
})

describe('the emergency fund offer drill-down', () => {
  it('sizes the first step as one month of essentials, and lists what counts as essential', () => {
    const drill = emergencyOfferDrill(offerView())
    expect(drill.figure).toEqual({ cents: 200_000 })
    expect(said(drill)).toBe(
      'First step $2,000 = What Rent and Groceries cost a month $2,000 times months 1',
    )
    expect(drill.items).toEqual({
      title: 'Counted as essential',
      rows: [
        { key: 'Rent', label: 'Rent' },
        { key: 'Groceries', label: 'Groceries' },
      ],
    })
  })

  it('lists no categories when bills size it', () => {
    const bills = essentials({ from: 'bills', categories: null, categoryIds: null })
    const drill = emergencyOfferDrill(offerView({ essentials: bills }))
    expect(drill.items).toBeUndefined()
    expect(said(drill)).toMatch(/What your bills cost a month/)
  })
})
