import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/context.js'
import { alertLogLine, changedLinesOnly, listAlerts, selectAccounts } from '../src/domain/alerts.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC.
let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** A checking account with these balances, as a bank sync stores them. */
async function checking(
  name: string,
  balances: { balanceCents: number; availableCents: number | null },
  hidden = false,
): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, {
    name,
    balanceCents: balances.balanceCents,
    hidden,
  })
  await ctx.db.query(
    `UPDATE accounts SET subtype = 'checking', available_cents = $2 WHERE id = $1`,
    [accountId, balances.availableCents],
  )
  return accountId
}

describe('list_alerts', () => {
  it('finds nothing on a fresh install', async () => {
    expect(await call('list_alerts')).toEqual([])
  })

  it('flags an overdrawn account, a low one and a recent fee, worst first', async () => {
    const everyday = await checking('Everyday', { balanceCents: 2000, availableCents: -4210 })
    await checking('Bills', { balanceCents: 6000, availableCents: 6000 })
    await insertBankTransaction(ctx.db, everyday, {
      date: '2026-11-12',
      name: 'SERVICE CHARGE',
      amountCents: 3500,
      detailed: 'BANK_FEES_OVERDRAFT_FEES',
    })

    const alerts = await call('list_alerts')

    expect(alerts.map((a) => [a.kind, a.accountName, a.amountCents])).toEqual([
      ['overdrawn', 'Everyday', 4210],
      ['overdraft_fee', 'Everyday', 3500],
      ['low_balance', 'Bills', 6000],
    ])
    // Money and dates read in the owner's format.
    expect(alerts[0]!.message).toBe('Everyday is overdrawn by $42.10.')
    expect(alerts[1]!.message).toContain('most recently Nov 12')
  })

  it('counts fees from the last 30 days only, today included', async () => {
    const account = await checking('Everyday', { balanceCents: 50000, availableCents: 50000 })
    for (const date of ['2026-10-18', '2026-10-19', '2026-11-17', '2026-11-18']) {
      await insertBankTransaction(ctx.db, account, { date, name: 'NSF FEE', amountCents: 3400 })
    }
    const [alert] = await call('list_alerts')
    expect(alert).toMatchObject({ kind: 'overdraft_fee', count: 2, date: '2026-11-17' })
  })

  it('includes hidden accounts, since an overdraft there still costs money', async () => {
    await checking('Old joint', { balanceCents: -900, availableCents: null }, true)
    const alerts = await call('list_alerts')
    expect(alerts.map((a) => a.accountName)).toEqual(['Old joint'])
  })

  it('narrows to the accounts asked for', async () => {
    const short = await checking('Short', { balanceCents: -100, availableCents: -100 })
    const low = await checking('Low', { balanceCents: 500, availableCents: 500 })
    expect((await call('list_alerts', { accountIds: [low] })).map((a) => a.accountName)).toEqual([
      'Low',
    ])
    expect((await call('list_alerts', { accountIds: [short] })).map((a) => a.kind)).toEqual([
      'overdrawn',
    ])
  })

  it("follows each account's own low-balance warning", async () => {
    const account = await checking('Everyday', { balanceCents: 15000, availableCents: 15000 })
    expect(await call('list_alerts')).toEqual([])

    await call('update_account', { id: account, lowBalanceCents: 20000 })
    expect((await call('list_alerts')).map((a) => a.kind)).toEqual(['low_balance'])

    await call('update_account', { id: account, lowBalanceCents: 0 })
    expect(await call('list_alerts')).toEqual([])

    // Null goes back to the default.
    const reset = await call('update_account', { id: account, lowBalanceCents: null })
    expect(reset.lowBalanceCents).toBeNull()
  })

  it('reads alerts the same way when called directly', async () => {
    await checking('Everyday', { balanceCents: -100, availableCents: null })
    const settings = await getSettings(ctx.db)
    expect(await listAlerts(ctx.db, settings, '2026-11-17')).toHaveLength(1)
  })
})

describe('selectAccounts', () => {
  const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('keeps the picked accounts in their usual order', () => {
    expect(selectAccounts(accounts, ['c', 'a'])).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  it('picks every account when none, or only unknown ones, are asked for', () => {
    expect(selectAccounts(accounts, [])).toEqual(accounts)
    expect(selectAccounts(accounts, ['gone'])).toEqual(accounts)
  })
})

describe('the alert counts in the server log', () => {
  it('counts without naming anything', async () => {
    await checking('Everyday', { balanceCents: -100, availableCents: -100 })
    const settings = await getSettings(ctx.db)
    const line = await alertLogLine(ctx.db, settings, '2026-11-17')
    expect(line).toBe(
      'Alerts: 1 account overdrawn, 0 cards over their limit, 0 low, 0 overdraft fees in the last 30 days',
    )
    expect(line).not.toContain('Everyday')
  })

  it('logs a line only when it differs from the last one', () => {
    const log = vi.fn()
    const report = changedLinesOnly(log)
    report('Alerts: 0')
    report('Alerts: 0')
    report('Alerts: 1')
    report('Alerts: 0')
    expect(log.mock.calls).toEqual([['Alerts: 0'], ['Alerts: 1'], ['Alerts: 0']])
  })
})
