// Sinking funds through their actions: suggestions found in the history,
// one-tap adding and dismissing, funds added by hand, and each fund's share
// held back from the budget like a goal set aside. Every name and amount is
// made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { HOLIDAYS_KEY } from '../src/domain/sinkingFunds/detect.js'
import { FUND_COLOR } from '../src/domain/sinkingFunds/setAsides.js'
import { actionCaller } from './actionCaller.js'
import { everyDays, insertPaychecks } from './fixtures/pay.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC.
let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const checking = () =>
  insertBankAccount(ctx.db, { subtype: 'checking', mask: '9876' }).then((a) => a.accountId)

const insurance = {
  name: 'Car insurance',
  amountCents: 78_000,
  cadence: 'year' as const,
  dueDate: '2027-03-01',
}

describe('list_sinking_funds', () => {
  it('has nothing to show at first, and shares by budget period while no pay is known', async () => {
    expect(await call('list_sinking_funds')).toEqual({
      shareOf: 'period',
      cadence: 'month',
      funds: [],
      suggestions: [],
      totalShareCents: 0,
    })
  })

  it('suggests a renewal from about a year ago and a yearly bill, never a payment to a person', async () => {
    const accountId = await checking()
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-12-15',
      name: 'ACME AUTO INSURANCE',
      amountCents: 64_000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-12-12',
      name: 'Zelle payment to Pat annual insurance share',
      amountCents: 30_000,
    })
    await call('create_bill', {
      name: 'Registration',
      amountCents: 12_000,
      cadence: 'year',
      anchorDate: '2027-04-01',
    })
    const { suggestions } = await call('list_sinking_funds')
    expect(suggestions.map((s) => [s.basis, s.amountCents, s.dueDate])).toEqual([
      ['bill', 12_000, '2027-04-01'],
      ['renewal', 64_000, '2026-12-15'],
    ])
    // $640 a year is $53.34 a month, rounded up a cent.
    expect(suggestions[1]!.shareCents).toBe(5_334)
    const said = JSON.stringify(suggestions)
    expect(said).not.toContain('Pat')
    expect(said).not.toContain('9876')
  })

  it('leaves out a renewal a tracked bill already covers', async () => {
    const accountId = await checking()
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-12-15',
      name: 'ACME AUTO INSURANCE',
      amountCents: 64_000,
    })
    await call('create_bill', {
      name: 'Insurance',
      amountCents: 6_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
      matchPattern: 'acme auto',
    })
    expect((await call('list_sinking_funds')).suggestions).toEqual([])
  })

  it('suggests the holidays from a December well above usual', async () => {
    const accountId = await checking()
    // History reaches back 400 days, to October 2025, a partial month left out.
    const months = ['2025-11', '2026-01', '2026-02', '2026-03', '2026-04']
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-10-20',
      name: 'GROCER',
      amountCents: 500,
    })
    for (const month of months) {
      await insertBankTransaction(ctx.db, accountId, {
        date: `${month}-12`,
        name: 'GROCER',
        amountCents: 150_000,
      })
    }
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-12-12',
      name: 'GROCER',
      amountCents: 260_000,
    })
    const { suggestions } = await call('list_sinking_funds')
    expect(suggestions.find((s) => s.key === HOLIDAYS_KEY)).toMatchObject({
      name: 'Holidays',
      amountCents: 110_000,
      dueDate: '2026-12-01',
    })
  })

  it('shares by paycheck once pay is known', async () => {
    const accountId = await checking()
    await insertPaychecks(ctx.db, accountId, everyDays('2026-09-04', 14, 6), 210_000)
    await call('add_sinking_fund', insurance)
    const view = await call('list_sinking_funds')
    expect(view).toMatchObject({ shareOf: 'paycheck', cadence: 'biweek' })
    // $780 a year over 26.09 paychecks.
    expect(view.funds[0]!.shareCents).toBe(2_990)
    expect(view.totalShareCents).toBe(2_990)
  })
})

describe('add, dismiss and delete', () => {
  it('adds a suggestion in one tap, once, and stops suggesting it', async () => {
    await call('create_bill', {
      name: 'Registration',
      amountCents: 12_000,
      cadence: 'year',
      anchorDate: '2027-04-01',
    })
    const [suggestion] = (await call('list_sinking_funds')).suggestions
    const { name, amountCents, cadence, dueDate, key } = suggestion!
    const added = await call('add_sinking_fund', {
      name,
      amountCents,
      cadence,
      dueDate,
      sourceKey: key,
    })
    expect(added).toMatchObject({
      name: 'Registration',
      nextDueDate: '2027-04-01',
      perPeriodCents: 1_000,
    })
    const view = await call('list_sinking_funds')
    expect(view.suggestions).toEqual([])
    expect(view.funds.map((f) => f.name)).toEqual(['Registration'])
    const again = await callError('add_sinking_fund', {
      name: 'Registration',
      amountCents: 12_000,
      cadence: 'year',
      dueDate: '2027-04-01',
      sourceKey: suggestion!.key,
    })
    expect(again).toMatchObject({
      code: 'conflict',
      message: 'Registration is already a sinking fund',
    })
  })

  it('dismisses a suggestion for good, even twice', async () => {
    await call('create_bill', {
      name: 'Registration',
      amountCents: 12_000,
      cadence: 'year',
      anchorDate: '2027-04-01',
    })
    const [suggestion] = (await call('list_sinking_funds')).suggestions
    await call('dismiss_sinking_fund', { key: suggestion!.key })
    expect(await call('dismiss_sinking_fund', { key: suggestion!.key })).toEqual({
      dismissed: true,
    })
    expect((await call('list_sinking_funds')).suggestions).toEqual([])
  })

  it('adds one by hand, lists the soonest due first, and deletes it', async () => {
    const water = await call('add_sinking_fund', {
      name: 'Water',
      amountCents: 24_000,
      cadence: 'quarter',
      dueDate: '2026-12-10',
    })
    await call('add_sinking_fund', insurance)
    const { funds } = await call('list_sinking_funds')
    expect(funds.map((f) => [f.name, f.nextDueDate, f.perPeriodCents])).toEqual([
      ['Water', '2026-12-10', 8_000],
      ['Car insurance', '2027-03-01', 6_500],
    ])
    expect(await call('delete_sinking_fund', { id: water.id })).toEqual({ deleted: true })
    expect(await callError('delete_sinking_fund', { id: water.id })).toMatchObject({
      code: 'not_found',
    })
  })
})

describe('the budget', () => {
  it('holds back each fund’s share of the period, beside goals', async () => {
    await call('add_sinking_fund', insurance)
    const budget = await call('get_budget')
    expect(budget.setAsides).toEqual([
      expect.objectContaining({
        name: 'Car insurance',
        color: FUND_COLOR,
        amountCents: 6_500,
        kind: 'sinking_fund',
      }),
    ])
    expect(budget.totals.setAsideCents).toBe(6_500)
  })
})
