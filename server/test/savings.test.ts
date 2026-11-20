import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { getCheckin } from '../src/domain/checkin.js'
import type { Db } from '../src/db/pool.js'
import { listAccounts } from '../src/domain/accounts.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import type * as ProfileModule from '../src/domain/profile/profile.js'
import { getSavingsGlance, getSavingsReport } from '../src/domain/savings/report.js'
import { balanceHistory } from '../src/domain/savings/store.js'
import { getSettings, saveSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The real profile, watched, so a test can tell when something builds it whole.
vi.mock('../src/domain/profile/profile.js', async (importOriginal) => {
  const original = await importOriginal<typeof ProfileModule>()
  return { ...original, getFinancialProfile: vi.fn(original.getFinancialProfile) }
})

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
      // The name shown everywhere: the bank's short name, then the account's.
      name: 'Test Rollover IRA',
      institutionName: 'Test Bank',
      kind: 'retirement',
      kindChosen: false,
      notCounted: null,
    })
    // An assistant reads this report, so no account carries its number's last digits.
    for (const lens of report.lenses) {
      for (const account of lens.accounts) expect(account).not.toHaveProperty('mask')
    }
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
    // The rise recorded on the 1st is this month's: the month is measured from Oct 31.
    expect(retirement!.accounts[0]!.changes).toEqual({
      month: { changeCents: 1_000_000, since: '2026-11-01' },
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
      name: 'Global stocks',
      type: 'investment',
      subtype: 'isa',
      balanceCents: 900_000,
      currency: 'GBP',
    })
    const report = await call('summarize_savings')
    const accounts = report.lenses.flatMap((v) => v.accounts)
    expect(accounts.map((a) => [a.name, a.notCounted])).toEqual([
      ['Test New IRA', 'no_balance'],
      ['Test Global stocks', 'other_currency'],
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

describe('net contributions', () => {
  it('nets withdrawals from savings, and counts only the owner’s currency', async () => {
    const { checking } = await fidelity()
    const transfer = (date: string, amountCents: number, detailed: string) =>
      insertBankTransaction(ctx.db, checking.accountId, {
        date,
        name: 'Online transfer',
        amountCents,
        detailed,
      })
    await transfer('2026-10-01', 100_000, 'TRANSFER_OUT_SAVINGS')
    await transfer('2026-10-15', -60_000, 'TRANSFER_IN_SAVINGS')
    await transfer('2026-10-02', 50_000, 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS')
    await transfer('2026-10-20', -20_000, 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS')
    // A transfer in another currency cannot be added to dollars.
    const euros = await transfer('2026-10-05', 900_000, 'TRANSFER_OUT_SAVINGS')
    await ctx.db.query(`UPDATE transactions SET currency = 'EUR' WHERE id = $1`, [euros])

    const { contributions } = await call('summarize_savings')
    expect(contributions).toMatchObject({
      since: '2026-10-01',
      totalCents: { cash: 40_000, invested: 30_000 },
      transferCount: 2,
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
      ['savings', [['Test Checking', true]]],
      ['retirement', [['Test Rollover IRA', false]]],
      [
        'investment',
        [
          ['Test High yield savings', true],
          ['Test Individual', false],
        ],
      ],
    ])

    await call('update_account', { id: savings.accountId, kind: 'other' })
    await call('update_account', { id: checking.accountId, kind: null })
    report = await call('summarize_savings')
    expect(report.lenses.map((v) => v.kind)).toEqual(['retirement', 'investment'])
    const accounts = await call('list_accounts')
    expect(accounts.find((a) => a.id === checking.accountId)).toMatchObject({
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

  it('clears a pick that no longer fits when a manual account changes type', async () => {
    const account = await call('create_account', {
      name: 'Rainy day',
      type: 'depository',
      balanceCents: 5000,
    })
    await call('update_account', { id: account.id, kind: 'savings' })
    const loan = await call('update_account', { id: account.id, type: 'loan' })
    expect(loan).toMatchObject({ kindChoice: null, kind: 'loan' })
    // Changing it back does not bring an old pick back with it.
    const back = await call('update_account', { id: account.id, type: 'depository' })
    expect(back).toMatchObject({ kindChoice: null, kind: 'checking' })
  })

  it('keeps a pick that still fits the new type', async () => {
    const account = await call('create_account', {
      name: 'Gold coins',
      type: 'other',
      balanceCents: 5000,
    })
    await call('update_account', { id: account.id, kind: 'other' })
    const loan = await call('update_account', { id: account.id, type: 'loan' })
    expect(loan).toMatchObject({ kindChoice: 'other', kind: 'other' })
    const property = await call('update_account', { id: account.id, type: 'property' })
    expect(property).toMatchObject({ kindChoice: 'other', kind: 'other' })
  })

  it('falls back to the automatic kind for a stored pick that does not fit', async () => {
    // Only possible for rows written before a type change cleared the pick.
    const account = await call('create_account', { name: 'Old', type: 'loan', balanceCents: 5 })
    await ctx.db.query(`UPDATE accounts SET kind = 'savings' WHERE id = $1`, [account.id])
    const [listed] = await call('list_accounts')
    expect(listed).toMatchObject({ kindChoice: 'savings', kind: 'loan' })
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

describe('the savings migration', () => {
  let dir: string
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('backfills an account with no history on the owner’s day, not the database’s', async () => {
    // A zone whose date differs from UTC's right now, whatever the hour.
    const zone = new Date().getUTCHours() < 10 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati'
    // Rebuild the database as it stood before this migration.
    dir = await mkdtemp(join(tmpdir(), 'leeway-before-013-'))
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
    for (const file of await readdir(migrations)) {
      if (file < '013') await copyFile(join(migrations, file), join(dir, file))
    }
    await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(ctx.db, dir)
    await ctx.db.query(`UPDATE settings SET data = jsonb_build_object('timeZone', $1::text)`, [
      zone,
    ])
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 4_200 })
    await ctx.db.query('DELETE FROM balance_history')

    // Later migrations run after it; this one is the one under test.
    expect(await migrate(ctx.db)).toContain('013_savings.sql')
    const { rows } = await ctx.db.query<{ cents: number; owners: boolean; utc: boolean }>(
      `SELECT balance_cents AS cents, day = (now() AT TIME ZONE $2)::date AS owners,
         day = (now() AT TIME ZONE 'UTC')::date AS utc
       FROM balance_history WHERE account_id = $1`,
      [accountId, zone],
    )
    expect(rows).toEqual([{ cents: 4_200, owners: true, utc: false }])
  })
})

describe('the savings glance', () => {
  it('gives the same month, totals and contributions as the full report', async () => {
    const { ira, brokerage, savings, checking } = await fidelity()
    await setHistory(ira.accountId, [
      ['2025-10-01', 4_000_000],
      ['2026-10-20', 4_700_000],
      ['2026-11-01', 4_900_000],
    ])
    // Seen only since the 10th: left out of this month beside the IRA, as the report does.
    await setHistory(savings.accountId, [['2026-11-10', 750_000]])
    await setHistory(brokerage.accountId, [['2026-09-01', 1_000_000]])
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-09-01',
      name: 'Online transfer',
      amountCents: 30_000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    const settings = await getSettings(ctx.db)
    const accounts = await listAccounts(ctx.db, false)
    const report = await getSavingsReport(ctx.db, settings, '2026-11-19', accounts)
    const glance = await getSavingsGlance(ctx.db, settings, '2026-11-19', accounts)
    expect(glance).toEqual({
      hasSavings: true,
      totalCents: report.totalCents,
      cashCents: 800_000,
      month: report.changes.month,
      contributions: report.contributions,
    })
    // The IRA's $3,000 since Oct 20 and the brokerage's $2,000 since Sep 1.
    expect(glance.month).toEqual({
      changeCents: 500_000,
      since: '2026-11-01',
      accountsLeftOut: 1,
    })
  })

  it('reads only the history this month needs', async () => {
    const { ira, savings } = await fidelity()
    await setHistory(ira.accountId, [
      ['2025-10-01', 4_000_000],
      ['2026-10-20', 4_700_000],
      ['2026-11-01', 4_900_000],
    ])
    await setHistory(savings.accountId, [['2026-11-10', 750_000]])
    const ids = [ira.accountId, savings.accountId]
    // Each account keeps its last balance on or before Oct 31, and everything after.
    const recent = await balanceHistory(ctx.db, ids, '2026-11-19', '2026-10-31')
    expect(recent.get(ira.accountId)!.map((point) => point.day)).toEqual([
      '2026-10-20',
      '2026-11-01',
    ])
    expect(recent.get(savings.accountId)!.map((point) => point.day)).toEqual(['2026-11-10'])
    // Without a day, all of it.
    const all = await balanceHistory(ctx.db, ids, '2026-11-19')
    expect(all.get(ira.accountId)).toHaveLength(3)
  })

  it('has nothing to show without savings, and no cash figure without a savings account', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking' })
    const settings = await getSettings(ctx.db)
    const none = await getSavingsGlance(
      ctx.db,
      settings,
      '2026-11-19',
      await listAccounts(ctx.db, false),
    )
    expect(none).toEqual({
      hasSavings: false,
      totalCents: 0,
      cashCents: null,
      month: null,
      contributions: null,
    })
    await insertBankAccount(ctx.db, { type: 'investment', subtype: 'ira', balanceCents: 5_000 })
    // An account in another currency is listed as savings but never added up.
    await insertBankAccount(ctx.db, { subtype: 'savings', currency: 'EUR', balanceCents: 9_000 })
    const glance = await getSavingsGlance(
      ctx.db,
      settings,
      '2026-11-19',
      await listAccounts(ctx.db, false),
    )
    expect(glance).toMatchObject({ hasSavings: true, totalCents: 5_000, cashCents: 0 })
  })

  it('reuses the accounts it is given, rather than listing them again', async () => {
    await fidelity()
    const settings = await getSettings(ctx.db)
    const accounts = await listAccounts(ctx.db, false)
    const queries: string[] = []
    const watched = {
      query: (text: string, values?: unknown[]) => {
        queries.push(text)
        return ctx.db.query(text, values)
      },
    } as unknown as Db
    await getSavingsReport(watched, settings, '2026-11-19', accounts)
    await getSavingsGlance(watched, settings, '2026-11-19', accounts)
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.filter((text) => /FROM accounts\b/.test(text))).toEqual([])
  })
})

describe('the check-in', () => {
  it('agrees with the profile on savings, without building the whole profile', async () => {
    const { checking } = await fidelity()
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-09-01',
      name: 'Online transfer',
      amountCents: 30_000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    const settings = await getSettings(ctx.db)
    const profile = await getFinancialProfile(ctx.db, settings, '2026-11-19')
    // Two whole months of history: enough for the emergency fund to be known.
    expect(profile.emergencyFund?.monthsCovered).toEqual(expect.any(Number))
    vi.mocked(getFinancialProfile).mockClear()

    const { savings } = await getCheckin(ctx.db, settings, ctx.now(), '2026-11-19')
    expect(getFinancialProfile).not.toHaveBeenCalled()
    expect(savings).toMatchObject({
      totalCents: profile.savings.totalCents,
      emergencyFundMonths: profile.emergencyFund?.monthsCovered ?? null,
      bankSeenSavingsRatePercent: profile.savingsRate?.percent ?? null,
    })
  })

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
      hasSavingsAccounts: true,
      totalCents: 7_000_000,
      changeThisMonthCents: 200_000,
      changeSince: '2026-11-05',
      // No spending or bills yet, and no pay: unknown, never zero.
      emergencyFundMonths: null,
      emergencyFundTargetMonths: null,
      bankSeenSavingsRatePercent: null,
      payrollIncludedSavingsRatePercent: null,
      savingsRateNote: null,
      pension: null,
    })
  })
})
