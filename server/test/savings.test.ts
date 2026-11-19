import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getCheckin } from '../src/domain/checkin.js'
import { getSettings, saveSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver; balance history before
// today is written by hand, because the trigger dates rows by the real clock.
let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

/** Replaces an account's balance history with these days and balances. */
async function setHistory(accountId: string, points: [string, number][]): Promise<void> {
  await ctx.db.query('DELETE FROM balance_history WHERE account_id = $1', [accountId])
  for (const [day, cents] of points) {
    await ctx.db.query(
      'INSERT INTO balance_history (account_id, day, balance_cents) VALUES ($1, $2, $3)',
      [accountId, day, cents],
    )
  }
}

/** A Fidelity-like setup: a rollover IRA, a brokerage account, savings and checking. */
async function fidelity() {
  const ira = await insertBankAccount(ctx.db, {
    name: 'Rollover IRA',
    type: 'investment',
    subtype: 'ira',
    balanceCents: 5_000_000,
  })
  const brokerage = await insertBankAccount(ctx.db, {
    name: 'Individual',
    type: 'investment',
    subtype: 'brokerage',
    balanceCents: 1_200_000,
  })
  const savings = await insertBankAccount(ctx.db, {
    name: 'High yield savings',
    subtype: 'savings',
    balanceCents: 800_000,
  })
  const checking = await insertBankAccount(ctx.db, {
    name: 'Checking',
    subtype: 'checking',
    balanceCents: 300_000,
  })
  // The trigger dated these by the real clock; each test writes the history it needs.
  await ctx.db.query('DELETE FROM balance_history')
  return { ira, brokerage, savings, checking }
}

describe('summarize_savings', () => {
  it('reports nothing to show when no account is savings', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking' })
    const report = await call('summarize_savings')
    expect(report).toMatchObject({
      hasSavings: false,
      totalCents: 0,
      lenses: [],
      history: [],
      historyStartsOn: null,
      contributions: null,
    })
  })

  it('gives each kind a lens with its total, its accounts and the same four parts', async () => {
    await fidelity()
    const report = await call('summarize_savings')
    expect(report.hasSavings).toBe(true)
    expect(report.totalCents).toBe(7_000_000)
    expect(report.lenses.map((v) => [v.kind, v.title, v.totalCents])).toEqual([
      ['savings', 'Savings', 800_000],
      ['retirement', 'Retirement', 5_000_000],
      ['investment', 'Investing', 1_200_000],
    ])
    expect(report.lenses[1]!.accounts[0]).toMatchObject({
      name: 'Rollover IRA',
      institutionName: 'Test Bank',
      kind: 'retirement',
      kindChosen: false,
      notCounted: null,
    })
    // Every lens asks its question and fills the same parts, so a screen draws each kind alike.
    expect(report.lenses.map((v) => [v.question, v.meters.map((m) => m.id)])).toEqual([
      ['How protected am I?', ['building', 'savings_rate']],
      ['Can I stop working on time?', ['growth', 'contributions']],
      ['How is it growing?', ['balance', 'contributions']],
    ])
  })

  it('measures changes from balance history, and says where history starts', async () => {
    const { ira, savings } = await fidelity()
    await setHistory(ira.accountId, [
      ['2025-10-01', 4_000_000],
      ['2026-11-01', 4_900_000],
    ])
    await setHistory(savings.accountId, [['2026-11-10', 750_000]])
    const report = await call('summarize_savings')
    const [cash, retirement] = report.lenses
    expect(retirement!.accounts[0]!.changes).toEqual({
      month: { changeCents: 100_000, since: '2026-11-01' },
      days30: { changeCents: 1_000_000, since: '2026-10-20' },
      year: { changeCents: 1_000_000, since: '2025-11-19' },
      all: { changeCents: 1_000_000, since: '2025-10-01' },
    })
    // Savings were first seen on Nov 10: no 30 day or year change, but this month counts from then.
    expect(cash!.accounts[0]!.changes.days30).toBeNull()
    expect(cash!.changes.month).toEqual({
      changeCents: 50_000,
      since: '2026-11-10',
      accountsLeftOut: 0,
    })
    // The grand total leaves out what has no history that far back, and says so.
    expect(report.changes.days30).toEqual({
      changeCents: 1_000_000,
      since: '2026-10-20',
      accountsLeftOut: 2,
    })
    expect(report.historyStartsOn).toBe('2025-10-01')
  })

  it('charts the total over time, ending with today’s balances', async () => {
    const { ira, brokerage, savings } = await fidelity()
    await setHistory(ira.accountId, [['2026-11-01', 4_900_000]])
    await setHistory(brokerage.accountId, [])
    await setHistory(savings.accountId, [['2026-11-10', 750_000]])
    const report = await call('summarize_savings')
    expect(report.history).toEqual([
      { day: '2026-11-01', cents: 4_900_000 },
      { day: '2026-11-10', cents: 5_650_000 },
      { day: '2026-11-19', cents: 7_000_000 },
    ])
    // Each lens charts its own kind, from the first day that kind has history.
    expect(report.lenses.map((lens) => [lens.kind, lens.history])).toEqual([
      [
        'savings',
        [
          { day: '2026-11-10', cents: 750_000 },
          { day: '2026-11-19', cents: 800_000 },
        ],
      ],
      [
        'retirement',
        [
          { day: '2026-11-01', cents: 4_900_000 },
          { day: '2026-11-19', cents: 5_000_000 },
        ],
      ],
      ['investment', [{ day: '2026-11-19', cents: 1_200_000 }]],
    ])
  })

  it('starts history today when Leeway has only just seen the accounts', async () => {
    const { ira, brokerage, savings } = await fidelity()
    for (const { accountId } of [ira, brokerage, savings]) await setHistory(accountId, [])
    const report = await call('summarize_savings')
    expect(report.historyStartsOn).toBe('2026-11-19')
    expect(report.history).toEqual([{ day: '2026-11-19', cents: 7_000_000 }])
    expect(report.changes.month).toBeNull()
  })

  it('never counts a balance recorded ahead of the owner’s day twice', async () => {
    const { ira } = await fidelity()
    // Dated tomorrow by a server clock in UTC, before balances followed the owner's day.
    await setHistory(ira.accountId, [
      ['2026-11-01', 4_900_000],
      ['2026-11-20', 5_000_000],
    ])
    const report = await call('summarize_savings')
    expect(report.lenses[1]!.accounts[0]!.changes.month?.changeCents).toBe(100_000)
    expect(report.history.at(-1)).toEqual({ day: '2026-11-19', cents: 7_000_000 })
  })

  it('lists accounts with no balance or another currency, without adding them up', async () => {
    await insertBankAccount(ctx.db, {
      name: 'New IRA',
      type: 'investment',
      subtype: 'roth',
      balanceCents: null,
    })
    await insertBankAccount(ctx.db, {
      name: 'ISA',
      type: 'investment',
      subtype: 'isa',
      balanceCents: 900_000,
      currency: 'GBP',
    })
    const report = await call('summarize_savings')
    const accounts = report.lenses.flatMap((v) => v.accounts)
    expect(accounts.map((a) => [a.name, a.notCounted])).toEqual([
      ['New IRA', 'no_balance'],
      ['ISA', 'other_currency'],
    ])
    expect(report.totalCents).toBe(0)
    expect(report.historyStartsOn).toBeNull()
    expect(report.history).toEqual([])
  })

  it('leaves hidden accounts out', async () => {
    await insertBankAccount(ctx.db, {
      type: 'investment',
      subtype: 'ira',
      balanceCents: 100,
      hidden: true,
    })
    expect((await call('summarize_savings')).hasSavings).toBe(false)
  })

  it('finds contributions from transfers out of everyday accounts only', async () => {
    const { checking, savings } = await fidelity()
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-01',
      name: 'Transfer to Fidelity',
      amountCents: 50_000,
      detailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2025-11-25',
      name: 'Opening deposit',
      amountCents: 1,
      detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
    })
    // Pending transfers, and the receiving side on a savings account, are not counted.
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-18',
      name: 'Transfer to savings',
      amountCents: 20_000,
      pending: true,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    await insertBankTransaction(ctx.db, savings.accountId, {
      date: '2026-11-01',
      name: 'Transfer from checking',
      amountCents: 70_000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    const { contributions } = await call('summarize_savings')
    expect(contributions).toMatchObject({
      since: '2025-11-25',
      totalCents: { cash: 0, invested: 50_000 },
      transferCount: 1,
    })
  })
})

describe('update_account kind', () => {
  it('changes an account kind, and goes back to the automatic one', async () => {
    const { savings, checking } = await fidelity()
    await call('update_account', { id: savings.accountId, kind: 'investment' })
    const moved = await call('update_account', { id: checking.accountId, kind: 'savings' })
    expect(moved).toMatchObject({ kindChoice: 'savings', kind: 'savings' })
    let report = await call('summarize_savings')
    expect(
      report.lenses.map((v) => [v.kind, v.accounts.map((a) => [a.name, a.kindChosen])]),
    ).toEqual([
      ['savings', [['Checking', true]]],
      ['retirement', [['Rollover IRA', false]]],
      [
        'investment',
        [
          ['High yield savings', true],
          ['Individual', false],
        ],
      ],
    ])

    await call('update_account', { id: savings.accountId, kind: 'other' })
    await call('update_account', { id: checking.accountId, kind: null })
    report = await call('summarize_savings')
    expect(report.lenses.map((v) => v.kind)).toEqual(['retirement', 'investment'])
    const accounts = await call('list_accounts')
    expect(accounts.find((a) => a.name === 'Checking')).toMatchObject({
      kindChoice: null,
      kind: 'checking',
    })
  })

  it('keeps cards and loans owed, and owned accounts owned', async () => {
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 100 })
    const error = await callError('update_account', { id: card.accountId, kind: 'savings' })
    expect(error.message).toMatch(/^A card or loan can only be/)
    const loan = await call('update_account', { id: card.accountId, kind: 'loan' })
    expect(loan.kind).toBe('loan')
    const brokerage = await insertBankAccount(ctx.db, { type: 'investment', subtype: 'brokerage' })
    const owned = await callError('update_account', {
      id: brokerage.accountId,
      kind: 'credit_card',
    })
    expect(owned.code).toBe('invalid_input')
    const unknown = await callError('update_account', { id: card.accountId, kind: 'vault' })
    expect(unknown.code).toBe('invalid_input')
  })

  it('checks a manual account against its new type in the same change', async () => {
    const account = await call('create_account', {
      name: 'Cash jar',
      type: 'depository',
      balanceCents: 5000,
    })
    expect(account.kind).toBe('checking')
    const error = await callError('update_account', {
      id: account.id,
      type: 'loan',
      kind: 'savings',
    })
    expect(error.code).toBe('invalid_input')
    const loan = await call('update_account', { id: account.id, type: 'loan', kind: 'loan' })
    expect(loan.kind).toBe('loan')
  })

  it('falls back to the automatic kind when a pick no longer fits the account', async () => {
    const account = await call('create_account', {
      name: 'Rainy day',
      type: 'depository',
      balanceCents: 5000,
    })
    await call('update_account', { id: account.id, kind: 'savings' })
    const loan = await call('update_account', { id: account.id, type: 'loan' })
    expect(loan).toMatchObject({ kindChoice: 'savings', kind: 'loan' })
  })
})

describe('balance history dates', () => {
  it('dates each balance by the owner’s time zone, one row per account per day', async () => {
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, { ...settings, timeZone: 'Pacific/Kiritimati' })
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100 })
    await ctx.db.query('UPDATE accounts SET balance_cents = 200 WHERE id = $1', [accountId])
    const { rows } = await ctx.db.query<{ day: string; expected: string; cents: number }>(
      `SELECT day, (now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS expected,
         balance_cents AS cents
       FROM balance_history WHERE account_id = $1`,
      [accountId],
    )
    expect(rows).toEqual([{ day: rows[0]!.expected, expected: rows[0]!.expected, cents: 200 }])
  })

  it('falls back to the database’s date when the stored time zone is unknown', async () => {
    await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "Mars/Olympus"}'`)
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100 })
    const { rows } = await ctx.db.query<{ same: boolean }>(
      'SELECT day = current_date AS same FROM balance_history WHERE account_id = $1',
      [accountId],
    )
    expect(rows).toEqual([{ same: true }])
  })
})

describe('the check-in', () => {
  it('carries savings at a glance, or null without any', async () => {
    const settings = await getSettings(ctx.db)
    const now = ctx.now()
    expect((await getCheckin(ctx.db, settings, now, '2026-11-19')).savings).toBeNull()

    const { ira } = await fidelity()
    // Accounts first seen today have no change to report yet.
    expect((await getCheckin(ctx.db, settings, now, '2026-11-19')).savings).toMatchObject({
      changeThisMonthCents: null,
      changeSince: null,
    })
    await setHistory(ira.accountId, [['2026-11-05', 4_800_000]])
    expect((await getCheckin(ctx.db, settings, now, '2026-11-19')).savings).toEqual({
      totalCents: 7_000_000,
      changeThisMonthCents: 200_000,
      changeSince: '2026-11-05',
      // No spending or bills yet, and no pay: unknown, never zero.
      emergencyFundMonths: null,
      emergencyFundTargetMonths: null,
      savingsRatePercent: null,
    })
  })
})
