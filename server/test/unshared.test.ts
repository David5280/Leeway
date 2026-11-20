import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BankAccount, BankTransaction } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import type { Db } from '../src/db/pool.js'
import { deleteAccount, getAccount, listAccounts } from '../src/domain/accounts.js'
import { getAccountsView } from '../src/domain/accountView.js'
import { listAlerts } from '../src/domain/alerts.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { linkBank, listConnections, reconnected } from '../src/domain/connections.js'
import { debtPlans } from '../src/domain/debts.js'
import { getNetWorth } from '../src/domain/netWorth.js'
import { getSettings } from '../src/domain/settings.js'
import { syncConnection } from '../src/domain/sync.js'
import { listTransactions, setCategory } from '../src/domain/transactions.js'
import {
  matchHistory,
  pairReturning,
  type HistoryLine,
  type KeptAccount,
} from '../src/domain/unshared.js'
import { AppError } from '../src/errors.js'
import { account, bankTx, FakeBank, newLink, page } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let bank: FakeBank

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  bank = new FakeBank()
  ctx.bank = bank
})

const TODAY = '2026-11-17'

/** A bank account with its own mask, so it can be told apart from the others. */
function bankAccount(
  id: string,
  name: string,
  type: BankAccount['type'],
  balanceCents: number,
  mask: string | null,
): BankAccount {
  return { ...account(id, name, type, balanceCents), mask }
}

const checking = bankAccount('acc-checking', 'Checking', 'depository', 250000, '1111')
const savings = bankAccount('acc-savings', 'Savings', 'depository', 900000, '2222')

/** Links a bank with checking and savings, savings with one interest payment. */
async function linkCheckingAndSavings(): Promise<{ connectionId: string; savingsId: string }> {
  bank.accounts = [checking, savings]
  bank.pages = [
    page({
      added: [
        bankTx({ name: 'Coffee', amountCents: 450 }),
        bankTx({
          providerTransactionId: 'ptx-interest',
          providerAccountId: 'acc-savings',
          name: 'Interest',
          amountCents: -1200,
          date: '2026-11-01',
        }),
      ],
    }),
  ]
  const { connectionId } = await linkBank(ctx, newLink('public-unshared'))
  const savingsId = (await listAccounts(ctx.db)).find((a) => a.bankName === 'Savings')!.id
  return { connectionId, savingsId }
}

/** The owner reconnects with savings un-ticked: Plaid then reports checking only. */
async function untickSavings(connectionId: string): Promise<void> {
  bank.accounts = [checking]
  await reconnected(ctx, connectionId)
}

const transactionsOf = async (accountId: string) =>
  (
    await listTransactions(ctx.db, {
      limit: 100,
      offset: 0,
      includeExcluded: true,
      accountIds: [accountId],
    })
  ).transactions

const accountRows = async () =>
  (
    await ctx.db.query<{ id: string; provider_account_id: string; unshared: boolean }>(
      `SELECT id, provider_account_id, unshared_at IS NOT NULL AS unshared
       FROM accounts ORDER BY created_at, id`,
    )
  ).rows

describe('an account the owner stops sharing', () => {
  it('is marked as no longer shared, with its balance and history kept', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)

    const kept = await getAccount(ctx.db, savingsId)
    expect(kept.unsharedAt).not.toBeNull()
    expect(kept.balanceCents).toBe(900000)
    expect((await transactionsOf(savingsId)).map((t) => t.name)).toEqual(['Interest'])
    expect((await listConnections(ctx.db))[0]).toMatchObject({
      accountCount: 1,
      unsharedCount: 1,
    })
  })

  it('keeps the time it was first marked through later syncs', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)
    const first = (await getAccount(ctx.db, savingsId)).unsharedAt
    await syncConnection(ctx, connectionId)
    expect((await getAccount(ctx.db, savingsId)).unsharedAt).toEqual(first)
  })

  it('leaves its balance out of net worth, debts, alerts and the counted accounts', async () => {
    const card = bankAccount('acc-card', 'Sapphire', 'credit', 50000, '3333')
    const overdrawn = { ...savings, balanceCents: -5000, availableCents: -5000 }
    bank.accounts = [checking, overdrawn, card]
    const { connectionId } = await linkBank(ctx, newLink('public-totals'))
    const settings = await getSettings(ctx.db)
    expect(await listAlerts(ctx.db, settings, TODAY)).toHaveLength(1)

    bank.accounts = [checking]
    await reconnected(ctx, connectionId)

    expect(await getNetWorth(ctx.db, TODAY, 30)).toMatchObject({
      assetsCents: 250000,
      liabilitiesCents: 0,
    })
    expect((await debtPlans(ctx.db, 0, TODAY)).debts).toEqual([])
    expect(await listAlerts(ctx.db, settings, TODAY)).toEqual([])
    expect((await listAccounts(ctx.db, false)).map((a) => a.bankName)).toEqual(['Checking'])
    // Still listed, so the owner can see it, remove it or share it again.
    expect(await listAccounts(ctx.db)).toHaveLength(3)
  })

  it('stays on the Accounts view but out of its balances, with a word in the summary', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)
    const settings = await getSettings(ctx.db)

    const all = await getAccountsView(ctx.db, settings, ctx.now(), [])
    expect(all.accounts).toHaveLength(2)
    expect(all.balances).toMatchObject({ cashCents: 250000, cashAccounts: 1 })
    expect(all.summary.points[0]).toBe(
      'First Platypus Savings is no longer shared from First Platypus Bank and is left out of these figures.',
    )

    const alone = await getAccountsView(ctx.db, settings, ctx.now(), [savingsId])
    expect(alone.balances).toMatchObject({ cashAccounts: 0, debtAccounts: 0, otherAccounts: 0 })
    expect(alone.summary.headline).toBe(
      'First Platypus Savings is no longer shared from First Platypus Bank, so it has no current balance.',
    )
    // Its history still counts as money that came in.
    expect(alone.flows.some((flow) => flow.inCents === 1200)).toBe(true)
  })

  it('is left alone when the bank reports no accounts at all', async () => {
    const { connectionId } = await linkCheckingAndSavings()
    bank.accounts = []
    await syncConnection(ctx, connectionId)
    expect((await accountRows()).every((row) => !row.unshared)).toBe(true)
  })
})

describe('sharing an account again', () => {
  it('brings it back as the same account when the bank keeps its id', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)

    bank.accounts = [checking, { ...savings, balanceCents: 910000 }]
    // Plaid may send the history again under the same ids, beside news on
    // other accounts, even one it does not report.
    bank.pages = [
      page({
        added: [
          bankTx({ name: 'Lunch', amountCents: 1500 }),
          bankTx({ providerAccountId: 'acc-unknown', name: 'Stray', amountCents: 100 }),
          bankTx({
            providerTransactionId: 'ptx-interest',
            providerAccountId: 'acc-savings',
            name: 'Interest',
            amountCents: -1200,
            date: '2026-11-01',
          }),
        ],
      }),
    ]
    await reconnected(ctx, connectionId)

    const back = await getAccount(ctx.db, savingsId)
    expect(back).toMatchObject({ unsharedAt: null, balanceCents: 910000 })
    expect(await accountRows()).toHaveLength(2)
    expect(await transactionsOf(savingsId)).toHaveLength(1)
  })

  it('brings it back as the same account, without doubling its history, under new ids', async () => {
    const interest = await createCategory(
      ctx.db,
      categoryInputSchema.parse({ name: 'Interest earned', kind: 'income' }),
    )
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    const [kept] = await transactionsOf(savingsId)
    await setCategory(ctx.db, [kept!.id], interest.id)
    await untickSavings(connectionId)

    // Plaid: "the existing account is removed and a new one is created with a new account_id".
    bank.accounts = [checking, { ...savings, providerAccountId: 'acc-savings-new' }]
    const onNew = { providerAccountId: 'acc-savings-new' }
    bank.pages = [
      page({
        added: [
          bankTx({
            ...onNew,
            providerTransactionId: 'ptx-interest-new',
            name: 'Interest',
            amountCents: -1200,
            date: '2026-11-01',
          }),
          bankTx({ ...onNew, name: 'Transfer in', amountCents: -5000, date: '2026-11-15' }),
        ],
      }),
    ]
    await reconnected(ctx, connectionId)

    const rows = await accountRows()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === savingsId)).toMatchObject({
      provider_account_id: 'acc-savings-new',
      unshared: false,
    })
    const history = await transactionsOf(savingsId)
    expect(history.map((t) => t.name).sort()).toEqual(['Interest', 'Transfer in'])
    // The row kept is the one the owner filed, now under the bank's new id.
    expect(history.find((t) => t.name === 'Interest')).toMatchObject({
      id: kept!.id,
      categoryId: interest.id,
      categorySource: 'manual',
    })
  })

  it('never doubles an account whose id changes while it is still shared', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    bank.accounts = [checking, { ...savings, providerAccountId: 'acc-savings-new' }]
    await syncConnection(ctx, connectionId)

    const rows = await accountRows()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === savingsId)).toMatchObject({
      provider_account_id: 'acc-savings-new',
      unshared: false,
    })
  })

  it('pairs an unmasked account when it is the only one of its type and name', async () => {
    const unmasked = { ...savings, mask: null }
    bank.accounts = [checking, unmasked]
    const { connectionId } = await linkBank(ctx, newLink('public-unmasked'))
    const savingsId = (await listAccounts(ctx.db)).find((a) => a.bankName === 'Savings')!.id
    bank.accounts = [checking]
    await reconnected(ctx, connectionId)

    bank.accounts = [checking, { ...unmasked, providerAccountId: 'acc-savings-new' }]
    await reconnected(ctx, connectionId)

    expect(await accountRows()).toHaveLength(2)
    expect(await getAccount(ctx.db, savingsId)).toMatchObject({ unsharedAt: null })
  })

  it('comes in as a new account when two unmasked ones share a name, flagging the old one', async () => {
    const first = { ...savings, mask: null }
    const second = { ...first, providerAccountId: 'acc-savings-2', balanceCents: 1000 }
    bank.accounts = [checking, first, second]
    const { connectionId } = await linkBank(ctx, newLink('public-unmasked'))
    bank.accounts = [checking]
    await reconnected(ctx, connectionId)

    // Two kept accounts called Savings, one arriving: nothing says which it is.
    bank.accounts = [checking, { ...first, providerAccountId: 'acc-savings-new' }]
    await reconnected(ctx, connectionId)

    // Accounts saved in one sync share a creation time, so they are compared by the bank's id.
    const byBankId = Object.fromEntries(
      (await accountRows()).map((row) => [row.provider_account_id, row.unshared]),
    )
    expect(byBankId).toEqual({
      'acc-checking': false,
      'acc-savings': true,
      'acc-savings-2': true,
      'acc-savings-new': false,
    })
    const accounts = await listAccounts(ctx.db)
    const arrived = accounts.find((a) => a.unsharedAt === null && a.bankName === 'Savings')!
    const flagged = accounts.filter((a) => a.mayBeBackAs !== null)
    expect(flagged).toHaveLength(2)
    expect(flagged.every((a) => a.mayBeBackAs === arrived.name)).toBe(true)
    expect(arrived.mayBeBackAs).toBeNull()
  })
})

describe('history after an account comes back', () => {
  const onNew = { providerAccountId: 'acc-savings-new' }
  const interestAgain = (fields: Partial<BankTransaction> = {}) =>
    bankTx({
      ...onNew,
      providerTransactionId: 'ptx-interest-new',
      name: 'Interest',
      amountCents: -1200,
      date: '2026-11-01',
      ...fields,
    })

  /** Links, un-ticks savings, then ticks it again under a new id with no transactions yet. */
  async function backUnderNewId(): Promise<{ connectionId: string; savingsId: string }> {
    const linked = await linkCheckingAndSavings()
    await untickSavings(linked.connectionId)
    bank.accounts = [checking, { ...savings, ...onNew }]
    await reconnected(ctx, linked.connectionId)
    return linked
  }

  it('is adopted when it arrives a sync after the account came back', async () => {
    const { connectionId, savingsId } = await backUnderNewId()
    // Plaid fetches the history after the window closes and sends it in a later sync.
    bank.pages = [page({ added: [interestAgain()] })]
    await syncConnection(ctx, connectionId)

    expect((await transactionsOf(savingsId)).map((t) => t.name)).toEqual(['Interest'])
  })

  it('adopts each kept transaction once', async () => {
    const { connectionId, savingsId } = await backUnderNewId()
    bank.pages = [page({ added: [interestAgain()] })]
    await syncConnection(ctx, connectionId)
    // A second equal payment that day is a payment of its own.
    bank.pages = [page({ added: [interestAgain({ providerTransactionId: 'ptx-interest-2' })] })]
    await syncConnection(ctx, connectionId)

    expect(await transactionsOf(savingsId)).toHaveLength(2)
  })

  it('stops adopting once the window has passed', async () => {
    const { connectionId, savingsId } = await backUnderNewId()
    await ctx.db.query(`UPDATE transactions SET adopt_until = now() - interval '1 second'`)
    bank.pages = [page({ added: [interestAgain()] })]
    await syncConnection(ctx, connectionId)

    expect(await transactionsOf(savingsId)).toHaveLength(2)
    const { rows } = await ctx.db.query('SELECT 1 FROM transactions WHERE adopt_until IS NOT NULL')
    expect(rows).toEqual([])
  })

  it('never adopts transactions that arrived after the account came back', async () => {
    const { connectionId, savingsId } = await backUnderNewId()
    const fare = { ...onNew, name: 'Metro fare', amountCents: 275, date: '2026-11-18' }
    bank.pages = [page({ added: [bankTx({ ...fare, providerTransactionId: 'ptx-fare-1' })] })]
    await syncConnection(ctx, connectionId)
    bank.pages = [page({ added: [bankTx({ ...fare, providerTransactionId: 'ptx-fare-2' })] })]
    await syncConnection(ctx, connectionId)

    expect((await transactionsOf(savingsId)).filter((t) => t.name === 'Metro fare')).toHaveLength(2)
  })

  it('keeps two equal fares on one day when the account comes back under the same id', async () => {
    const fare = {
      providerAccountId: 'acc-savings',
      name: 'Metro fare',
      amountCents: 275,
      date: '2026-11-16',
    }
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    bank.pages = [page({ added: [bankTx({ ...fare, providerTransactionId: 'ptx-fare-1' })] })]
    await syncConnection(ctx, connectionId)
    await untickSavings(connectionId)

    // Ticked again under its own id: the cursor carries on, so only the news comes.
    bank.accounts = [checking, savings]
    bank.pages = [page({ added: [bankTx({ ...fare, providerTransactionId: 'ptx-fare-2' })] })]
    await reconnected(ctx, connectionId)

    expect((await transactionsOf(savingsId)).filter((t) => t.name === 'Metro fare')).toHaveLength(2)
  })
})

describe('removing an account the bank no longer shares', () => {
  it('deletes the account and its history', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)

    await deleteAccount(ctx.db, savingsId)

    expect(await accountRows()).toHaveLength(1)
    const { rows } = await ctx.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM transactions WHERE account_id = $1',
      [savingsId],
    )
    expect(rows[0]!.n).toBe(0)
    expect((await listConnections(ctx.db))[0]).toMatchObject({
      accountCount: 1,
      unsharedCount: 0,
    })
  })

  it('counts payments to a removed card as spending again', async () => {
    const transfers = await createCategory(
      ctx.db,
      categoryInputSchema.parse({
        name: 'Transfers',
        kind: 'transfer',
        providerCategories: ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'],
      }),
    )
    const card = bankAccount('acc-card', 'Sapphire', 'credit', 50000, '3333')
    bank.accounts = [checking, card]
    bank.pages = [
      page({
        added: [
          bankTx({
            name: 'PAYMENT TO CARD ENDING 3333',
            amountCents: 20000,
            categoryPrimary: 'LOAN_PAYMENTS',
            categoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
          }),
        ],
      }),
    ]
    const { connectionId } = await linkBank(ctx, newLink('public-card'))
    const checkingId = (await listAccounts(ctx.db)).find((a) => a.bankName === 'Checking')!.id
    const [payment] = await transactionsOf(checkingId)
    expect(payment!.categoryId).toBe(transfers.id)

    bank.accounts = [checking]
    await reconnected(ctx, connectionId)
    const cardId = (await listAccounts(ctx.db)).find((a) => a.bankName === 'Sapphire')!.id
    await deleteAccount(ctx.db, cardId)

    expect((await transactionsOf(checkingId))[0]!.categoryId).toBeNull()
  })

  it('refuses one the bank shares again between the check and the delete', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)
    // A sync landing in between: the account is shared again just before the delete runs.
    const racing = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('DELETE FROM accounts')) {
          await ctx.db.query('UPDATE accounts SET unshared_at = NULL WHERE id = $1', [savingsId])
        }
        return ctx.db.query(text, values)
      },
    } as unknown as Db

    await expect(deleteAccount(racing, savingsId)).rejects.toBeInstanceOf(AppError)
    expect(await accountRows()).toHaveLength(2)
  })

  it('says an account already gone was not found', async () => {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    await untickSavings(connectionId)
    const racing = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('DELETE FROM accounts')) {
          await ctx.db.query('DELETE FROM accounts WHERE id = $1', [savingsId])
        }
        return ctx.db.query(text, values)
      },
    } as unknown as Db

    await expect(deleteAccount(racing, savingsId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a bank account still shared, which the next sync would bring back', async () => {
    await linkCheckingAndSavings()
    const [first] = await listAccounts(ctx.db)
    await expect(deleteAccount(ctx.db, first!.id)).rejects.toBeInstanceOf(AppError)
  })
})

describe('pairReturning', () => {
  const kept = (id: string, name: string, mask: string | null, type = 'depository') =>
    ({ id, providerAccountId: `old-${id}`, name, mask, type }) as KeptAccount

  it('pairs a new id with the kept account of the same type, name and mask', () => {
    const pairs = pairReturning(
      [kept('a', 'Checking', '1111'), kept('b', 'Savings', '2222')],
      [bankAccount('new', ' savings ', 'depository', 0, '2222')],
    )
    expect([...pairs]).toEqual([['new', 'b']])
  })

  it('pairs nothing across types, with another mask, or with another name', () => {
    const missing = [kept('a', 'Checking', '1111', 'credit'), kept('b', 'Savings', '2222')]
    expect(
      pairReturning(missing, [
        bankAccount('n1', 'Checking', 'depository', 0, '1111'),
        bankAccount('n2', 'Savings', 'depository', 0, '9999'),
        bankAccount('n3', 'Savings plus', 'depository', 0, '2222'),
      ]).size,
    ).toBe(0)
  })

  it('pairs without a mask only when one account of that type and name is missing and one arrives', () => {
    const alone = pairReturning(
      [kept('a', 'Savings', null), kept('b', 'Checking', '1111')],
      [bankAccount('n1', 'savings', 'depository', 0, '4444')],
    )
    expect([...alone]).toEqual([['n1', 'a']])

    const twoMissing = [kept('a', 'Savings', null), kept('b', 'Savings', null)]
    expect(
      pairReturning(twoMissing, [bankAccount('n1', 'Savings', 'depository', 0, null)]).size,
    ).toBe(0)

    const twoArriving = [
      bankAccount('n1', 'Savings', 'depository', 0, null),
      bankAccount('n2', 'Savings', 'depository', 0, null),
    ]
    expect(pairReturning([kept('a', 'Savings', null)], twoArriving).size).toBe(0)
  })

  it('pairs each kept account once', () => {
    const pairs = pairReturning(
      [kept('a', 'Checking', '1111')],
      [
        bankAccount('n1', 'Checking', 'depository', 0, '1111'),
        bankAccount('n2', 'Checking', 'depository', 0, '1111'),
      ],
    )
    expect([...pairs]).toEqual([['n1', 'a']])
  })
})

describe('matchHistory', () => {
  const line = (providerTransactionId: string, fields: Partial<HistoryLine> = {}): HistoryLine => ({
    accountId: 'acct',
    providerTransactionId,
    date: '2026-11-01',
    amountCents: 1200,
    name: 'Interest',
    ...fields,
  })
  const keptLine = (
    id: string,
    providerTransactionId: string,
    fields: Partial<HistoryLine> = {},
  ) => ({
    id,
    ...line(providerTransactionId, fields),
  })

  it('gives a kept transaction the new id of the one it matches', () => {
    expect(matchHistory([keptLine('row-1', 'old')], [line('new')])).toEqual([
      { id: 'row-1', providerTransactionId: 'new' },
    ])
  })

  it('matches two equal charges on one day one to one', () => {
    const adopted = matchHistory(
      [keptLine('row-1', 'old-1'), keptLine('row-2', 'old-2')],
      [line('new-1'), line('new-2'), line('new-3')],
    )
    expect(adopted).toEqual([
      { id: 'row-1', providerTransactionId: 'new-1' },
      { id: 'row-2', providerTransactionId: 'new-2' },
    ])
  })

  it('leaves alone ids the bank still sends, and lines that differ', () => {
    const adopted = matchHistory(
      [keptLine('row-1', 'same'), keptLine('row-2', 'old', { amountCents: 999 })],
      [
        line('same'),
        line('other-day', { date: '2026-11-02' }),
        line('other-account', { accountId: 'elsewhere', amountCents: 999 }),
      ],
    )
    expect(adopted).toEqual([])
  })
})
