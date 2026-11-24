// Sinking funds through their actions: suggestions found in the bills and
// the history, one-tap adding and dismissing, a fund following its bill,
// funds added by hand, and each fund's share held back from the budget like
// a goal set aside, never by the cash flow. Every name and amount is made up.

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

// The test clock reads 2026-11-17, in UTC. The default budget period is the calendar month.
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

const registration = () =>
  call('create_bill', {
    name: 'Registration',
    amountCents: 12_000,
    cadence: 'year',
    anchorDate: '2027-04-01',
  })

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

  it('suggests a yearly bill and a renewal, never a payment to a person or a mask', async () => {
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
    const bill = await registration()
    const { suggestions } = await call('list_sinking_funds')
    expect(suggestions.map((s) => [s.basis, s.billId, s.amountCents, s.dueDate])).toEqual([
      ['bill', bill.id, 12_000, '2027-04-01'],
      ['renewal', null, 64_000, '2026-12-15'],
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
    await insertBankTransaction(ctx.db, accountId, {
      date: '2025-10-20',
      name: 'GROCER',
      amountCents: 500,
    })
    for (const month of ['2025-11', '2026-01', '2026-02', '2026-03', '2026-04']) {
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

  it('shares by the paycheck the cash flow uses once pay is known', async () => {
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

describe('a fund following a bill', () => {
  it('is added in one tap by the bill, once, and is not suggested again', async () => {
    const bill = await registration()
    const added = await call('add_sinking_fund', { billId: bill.id })
    expect(added).toMatchObject({
      billId: bill.id,
      name: 'Registration',
      amountCents: 12_000,
      nextDueDate: '2027-04-01',
      perPeriodCents: 1_000,
    })
    expect((await call('list_sinking_funds')).suggestions).toEqual([])
    expect(await callError('add_sinking_fund', { billId: bill.id })).toMatchObject({
      code: 'conflict',
      message: 'Registration is already a sinking fund',
    })
  })

  it('takes the bill’s changes, and leaves once the bill is monthly or gone', async () => {
    const bill = await registration()
    await call('add_sinking_fund', { billId: bill.id })
    await call('update_bill', { id: bill.id, name: 'Car registration', amountCents: 24_000 })
    const [fund] = (await call('list_sinking_funds')).funds
    expect(fund).toMatchObject({ name: 'Car registration', perPeriodCents: 2_000 })
    await call('update_bill', { id: bill.id, cadence: 'month' })
    expect((await call('list_sinking_funds')).funds).toEqual([])
    await call('delete_bill', { id: bill.id })
    const { rows } = await ctx.db.query('SELECT 1 FROM sinking_funds')
    expect(rows).toEqual([])
  })

  it('refuses a bill that comes due more often, or one that is not there', async () => {
    const phone = await call('create_bill', {
      name: 'Phone',
      amountCents: 6_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    expect(await callError('add_sinking_fund', { billId: phone.id })).toMatchObject({
      code: 'invalid_input',
    })
    await call('delete_bill', { id: phone.id })
    expect(await callError('add_sinking_fund', { billId: phone.id })).toMatchObject({
      code: 'not_found',
    })
  })
})

describe('funds standing alone', () => {
  it('needs a bill or a whole cost', async () => {
    expect(await callError('add_sinking_fund', { name: 'Water' })).toMatchObject({
      code: 'invalid_input',
    })
  })

  it('adds a suggestion once by its key, and dismisses another for good', async () => {
    const added = { ...insurance, sourceKey: 'name:acme auto insurance' }
    await call('add_sinking_fund', added)
    expect(await callError('add_sinking_fund', added)).toMatchObject({ code: 'conflict' })
    const bill = await registration()
    await call('dismiss_sinking_fund', { key: `bill:${bill.id}` })
    expect(await call('dismiss_sinking_fund', { key: `bill:${bill.id}` })).toEqual({
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

describe('safe to spend', () => {
  it('holds back each fund’s share of the period beside a goal’s, and the cash flow never', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 500_000 })
    const before = await call('get_cash_flow')
    await call('create_goal', {
      name: 'Bike',
      targetCents: 60_000,
      targetDate: '2027-04-30',
      setAside: true,
    })
    await call('add_sinking_fund', insurance)
    const budget = await call('get_budget')
    expect(budget.setAsides).toEqual([
      expect.objectContaining({ name: 'Bike', amountCents: 10_000 }),
      expect.objectContaining({
        name: 'Car insurance',
        color: FUND_COLOR,
        amountCents: 6_500,
        kind: 'sinking_fund',
      }),
    ])
    expect(budget.totals.setAsideCents).toBe(16_500)
    // Like a goal's, a fund's share is not a bill before payday.
    expect((await call('get_cash_flow')).safeCents).toBe(before.safeCents)
  })
})
