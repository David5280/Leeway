import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BankAccount, BankTransaction } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import type { Db } from '../src/db/pool.js'
import { deleteAccount, getAccount, listAccounts } from '../src/domain/accounts.js'
import { getAccountsView } from '../src/domain/accountView.js'
import { listAlerts } from '../src/domain/alerts.js'
import { budgetSummary } from '../src/domain/budgetReport.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { linkBank, listConnections, reconnected } from '../src/domain/connections.js'
import { debtPlans } from '../src/domain/debts.js'
import { getNetWorth } from '../src/domain/netWorth.js'
import { getSettings } from '../src/domain/settings.js'
import { syncConnection } from '../src/domain/sync.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { listTransactions, setCategory, type Transaction } from '../src/domain/transactions.js'
import { pairHeldCharges, type CurrentCharge, type HeldCharge } from '../src/domain/heldCharges.js'
import { sameMerchant } from '../src/domain/merchantKey.js'
import { matchHistory, type HistoryLine } from '../src/domain/returnedHistory.js'
import { pairReturning, type KeptAccount } from '../src/domain/unshared.js'
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

  it('never adopts a second row for an id already adopted, when Plaid sends it again', async () => {
    const fare = { name: 'Metro fare', amountCents: 275, date: '2026-11-16' }
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    bank.pages = [
      page({
        added: [
          bankTx({ ...fare, providerAccountId: 'acc-savings', providerTransactionId: 'ptx-f1' }),
          bankTx({ ...fare, providerAccountId: 'acc-savings', providerTransactionId: 'ptx-f2' }),
        ],
      }),
    ]
    await syncConnection(ctx, connectionId)
    await untickSavings(connectionId)
    bank.accounts = [checking, { ...savings, ...onNew }]
    // The first fare comes back under a new id and is adopted...
    bank.pages = [page({ added: [bankTx({ ...fare, ...onNew, providerTransactionId: 'n1' })] })]
    await reconnected(ctx, connectionId)
    // ...then Plaid sends it again as modified, while the second fare's window is open.
    bank.pages = [page({ modified: [bankTx({ ...fare, ...onNew, providerTransactionId: 'n1' })] })]
    const result = await syncConnection(ctx, connectionId)

    expect(result.error).toBeNull()
    const fares = (await transactionsOf(savingsId)).filter((t) => t.name === 'Metro fare')
    expect(fares).toHaveLength(2)
  })

  const shell = { providerAccountId: 'acc-savings', name: 'Shell', amountCents: 8000 }

  /**
   * Links with an $80 Shell charge pending on savings (after any `earlier`
   * ones), lets `edit` touch it, un-ticks savings, then ticks it again under
   * a new id with `arriving`.
   */
  async function pendingThenBack(
    arriving: BankTransaction[],
    edit: (pendingId: string) => Promise<void> = async () => {},
    earlier: BankTransaction[] = [],
  ): Promise<{
    connectionId: string
    savingsId: string
    charges: () => Promise<Transaction[]>
  }> {
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    bank.pages = [
      page({
        added: [
          ...earlier,
          bankTx({ ...shell, providerTransactionId: 'ptx-p', date: '2026-11-15', pending: true }),
        ],
      }),
    ]
    await syncConnection(ctx, connectionId)
    await edit((await transactionsOf(savingsId)).find((t) => t.pending)!.id)
    await untickSavings(connectionId)
    bank.accounts = [checking, { ...savings, ...onNew }]
    bank.pages = [page({ added: arriving })]
    await reconnected(ctx, connectionId)
    const charges = async () => (await transactionsOf(savingsId)).filter((t) => t.name === 'Shell')
    return { connectionId, savingsId, charges }
  }

  const posted = (id: string, date: string) =>
    bankTx({ ...shell, ...onNew, providerTransactionId: id, date })

  it('drops a charge still pending when the account left, since Plaid sends it again', async () => {
    // Back under a new id, the charge has posted, dated two days later.
    const { charges } = await pendingThenBack([posted('n-posted', '2026-11-17')])
    expect((await charges()).map((t) => [t.date, t.pending])).toEqual([['2026-11-17', false]])
  })

  it("carries the owner's edits on a dropped pending charge over to the one it became", async () => {
    const fuel = await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Fuel' }))
    const { charges } = await pendingThenBack([posted('n-posted', '2026-11-17')], async (id) => {
      await setCategory(ctx.db, [id], fuel.id)
      await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
    })
    expect(await charges()).toEqual([
      expect.objectContaining({
        date: '2026-11-17',
        categoryId: fuel.id,
        categorySource: 'manual',
        note: 'Road trip',
      }),
    ])
  })

  /** Syncs `quiet` times with nothing new, then once more with `arriving`. */
  async function arriveLater(connectionId: string, quiet: number, arriving: BankTransaction[]) {
    for (let sync = 0; sync < quiet; sync++) {
      bank.pages = [page({})]
      await syncConnection(ctx, connectionId)
    }
    bank.pages = [page({ added: arriving })]
    await syncConnection(ctx, connectionId)
  }

  const heldCharges = async () =>
    (await ctx.db.query<{ name: string }>('SELECT name FROM held_charges')).rows

  it.each([1, 2])(
    'carries the edits over when the charge it became arrives %i syncs after the return',
    async (later) => {
      const { connectionId, charges } = await pendingThenBack([], async (id) => {
        await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
      })
      await arriveLater(connectionId, later - 1, [posted('n-posted', '2026-11-17')])

      expect((await charges()).map((t) => [t.date, t.note])).toEqual([['2026-11-17', 'Road trip']])
      expect(await heldCharges()).toEqual([])
    },
  )

  it('keeps a charge set aside out of every total and list while it waits', async () => {
    const settings = await getSettings(ctx.db)
    const spent = async () => (await budgetSummary(ctx.db, settings, ctx.now())).totals.spentCents
    let spentWhilePending = 0
    const { charges } = await pendingThenBack([], async () => {
      spentWhilePending = await spent()
    })

    expect(await heldCharges()).toEqual([{ name: 'Shell' }])
    expect(await spent()).toBe(spentWhilePending - 8000)
    expect(await charges()).toEqual([])
  })

  it('lets a charge set aside go once its window runs out', async () => {
    const { connectionId, charges } = await pendingThenBack([], async (id) => {
      await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
    })
    await ctx.db.query(`UPDATE held_charges SET held_until = now() - interval '1 minute'`)
    await arriveLater(connectionId, 0, [posted('n-posted', '2026-11-17')])

    expect((await charges()).map((t) => t.note)).toEqual([null])
    expect(await heldCharges()).toEqual([])
  })

  it('carries nothing over to an equal charge at another merchant', async () => {
    const groceries = bankTx({ ...onNew, name: 'Safeway', amountCents: 8000, date: '2026-11-16' })
    const { savingsId } = await pendingThenBack([groceries], async (id) => {
      await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
    })

    const fuelAndFood = (await transactionsOf(savingsId)).filter((t) => t.amountCents === 8000)
    expect(fuelAndFood.map((t) => [t.name, t.note])).toEqual([['Safeway', null]])
    expect(await heldCharges()).toEqual([{ name: 'Shell' }])
  })

  const pendingOnNew = (id: string, date: string) =>
    bankTx({ ...shell, ...onNew, providerTransactionId: id, date, pending: true })
  const noteAndHide = async (id: string) => {
    await ctx.db.query(
      `UPDATE transactions SET note = 'Road trip', excluded = true WHERE id = $1`,
      [id],
    )
  }
  const edits = async (charges: () => Promise<Transaction[]>) =>
    (await charges()).map((t) => [t.date, t.note, t.excluded]).sort()

  it('remembers a doubt after one of the charges behind it posts', async () => {
    const { connectionId, charges } = await pendingThenBack(
      [pendingOnNew('n-15', '2026-11-15'), pendingOnNew('n-16', '2026-11-16')],
      noteAndHide,
    )
    // Only the 11-16 charge moves, so it alone is new in this sync.
    bank.pages = [
      page({
        added: [{ ...posted('n-16-posted', '2026-11-17'), pendingProviderTransactionId: 'n-16' }],
        removed: ['n-16'],
      }),
    ]
    await syncConnection(ctx, connectionId)

    expect(await edits(charges)).toEqual([
      ['2026-11-15', null, false],
      ['2026-11-17', null, false],
    ])
    expect(await heldCharges()).toEqual([])
  })

  it('stays unpaired when one of the charges behind a doubt is reversed', async () => {
    const { connectionId, charges } = await pendingThenBack(
      [pendingOnNew('n-15', '2026-11-15'), pendingOnNew('n-16', '2026-11-16')],
      noteAndHide,
    )
    bank.pages = [page({ removed: ['n-15'] })]
    await syncConnection(ctx, connectionId)
    await arriveLater(connectionId, 0, [
      { ...posted('n-16-posted', '2026-11-17'), pendingProviderTransactionId: 'n-16' },
    ])

    expect(await edits(charges)).toEqual([
      ['2026-11-16', null, false],
      ['2026-11-17', null, false],
    ])
  })

  it('counts a pending charge and the posted one replacing it once', async () => {
    const { connectionId, charges } = await pendingThenBack([], noteAndHide)
    // The bank sends both before it removes the pending one.
    await arriveLater(connectionId, 0, [
      pendingOnNew('n-p', '2026-11-15'),
      { ...posted('n-posted', '2026-11-17'), pendingProviderTransactionId: 'n-p' },
    ])

    expect(await edits(charges)).toEqual([
      ['2026-11-15', null, false],
      ['2026-11-17', 'Road trip', true],
    ])
  })

  it('carries the edits to the pending charge it became, and on when that posts', async () => {
    const { connectionId, charges } = await pendingThenBack(
      [pendingOnNew('n-p', '2026-11-15')],
      noteAndHide,
    )
    bank.pages = [
      page({
        added: [{ ...posted('n-posted', '2026-11-17'), pendingProviderTransactionId: 'n-p' }],
        removed: ['n-p'],
      }),
    ]
    await syncConnection(ctx, connectionId)

    expect(await edits(charges)).toEqual([['2026-11-17', 'Road trip', true]])
  })

  it('carries nothing over when more than one charge could be the one it became', async () => {
    const { charges } = await pendingThenBack(
      [posted('n-1', '2026-11-16'), posted('n-2', '2026-11-18')],
      async (id) => {
        await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
      },
    )
    expect((await charges()).map((t) => t.note)).toEqual([null, null])
  })

  it('carries edits past an older equal charge whose history comes back too', async () => {
    const older = bankTx({ ...shell, providerTransactionId: 'ptx-old', date: '2026-11-16' })
    const { charges } = await pendingThenBack(
      [posted('n-old', '2026-11-16'), posted('n-posted', '2026-11-17')],
      async (id) => {
        await ctx.db.query(`UPDATE transactions SET note = 'Road trip' WHERE id = $1`, [id])
      },
      [older],
    )
    const notes = (await charges()).map((t) => [t.date, t.note]).sort()
    expect(notes).toEqual([
      ['2026-11-16', null],
      ['2026-11-17', 'Road trip'],
    ])
  })

  it('keeps a note on the fare the bank still sends under its own id', async () => {
    const fare = { name: 'Metro fare', amountCents: 275, date: '2026-11-16' }
    const { connectionId, savingsId } = await linkCheckingAndSavings()
    bank.pages = [
      page({
        added: [
          bankTx({ ...fare, providerAccountId: 'acc-savings', providerTransactionId: 'ptx-f1' }),
          bankTx({ ...fare, providerAccountId: 'acc-savings', providerTransactionId: 'ptx-f2' }),
        ],
      }),
    ]
    await syncConnection(ctx, connectionId)
    await ctx.db.query(
      `UPDATE transactions SET note = 'Commute' WHERE provider_transaction_id = 'ptx-f1'`,
    )
    await untickSavings(connectionId)

    // Back under a new account id, fare 1 keeps its own id while fare 2 gets a new one.
    bank.accounts = [checking, { ...savings, ...onNew }]
    bank.pages = [
      page({
        added: [
          bankTx({ ...fare, ...onNew, providerTransactionId: 'ptx-f1' }),
          bankTx({ ...fare, ...onNew, providerTransactionId: 'n2' }),
        ],
      }),
    ]
    await reconnected(ctx, connectionId)

    const { rows } = await ctx.db.query<{ id: string; note: string | null }>(
      `SELECT provider_transaction_id AS id, note FROM transactions
       WHERE account_id = $1 AND name = 'Metro fare' ORDER BY provider_transaction_id`,
      [savingsId],
    )
    expect(rows).toEqual([
      { id: 'n2', note: null },
      { id: 'ptx-f1', note: 'Commute' },
    ])
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

  const none = new Set<string>()
  const stored = (...ids: string[]) => new Set(ids.map((id) => `acct\u0000${id}`))

  it('gives a kept transaction the new id of the one it matches', () => {
    expect(matchHistory([keptLine('row-1', 'old')], [line('new')], none)).toEqual([
      { id: 'row-1', providerTransactionId: 'new' },
    ])
  })

  it('matches two equal charges on one day one to one', () => {
    const adopted = matchHistory(
      [keptLine('row-1', 'old-1'), keptLine('row-2', 'old-2')],
      [line('new-1'), line('new-2'), line('new-3')],
      none,
    )
    expect(adopted).toEqual([
      { id: 'row-1', providerTransactionId: 'new-1' },
      { id: 'row-2', providerTransactionId: 'new-2' },
    ])
  })

  it('adopts once for a line the bank lists twice in one sync', () => {
    const adopted = matchHistory(
      [keptLine('row-1', 'old-1'), keptLine('row-2', 'old-2')],
      [line('new-1'), line('new-1')],
      none,
    )
    expect(adopted).toEqual([{ id: 'row-1', providerTransactionId: 'new-1' }])
  })

  it('leaves alone ids the bank still sends, and lines that differ', () => {
    const adopted = matchHistory(
      [keptLine('row-1', 'same'), keptLine('row-2', 'old', { amountCents: 999 })],
      [
        line('same'),
        line('other-day', { date: '2026-11-02' }),
        line('other-account', { accountId: 'elsewhere', amountCents: 999 }),
      ],
      stored('same'),
    )
    expect(adopted).toEqual([])
  })

  it('adopts nothing for a line already stored', () => {
    expect(matchHistory([keptLine('row-1', 'old')], [line('saved')], stored('saved'))).toEqual([])
  })

  it('offers no kept row whose own id arrived, even when that line was stored before', () => {
    const adopted = matchHistory(
      [keptLine('fare-1', 'f1')],
      [line('f1'), line('new')],
      stored('f1'),
    )
    expect(adopted).toEqual([])
  })
})

describe('pairHeldCharges', () => {
  const heldAt = new Date('2026-11-17T18:00:00Z')
  const pending = (fields: Partial<HeldCharge> = {}): HeldCharge => ({
    id: 'held-1',
    accountId: 'acct',
    date: '2026-11-10',
    amountCents: 8000,
    name: 'SHELL OIL 5741',
    merchantName: null,
    categoryId: null,
    note: 'Fuel',
    excluded: false,
    subject: 'p-1',
    heldAt,
    ...fields,
  })
  const charge = (id: string, date: string, fields: Partial<CurrentCharge> = {}) => ({
    id,
    accountId: 'acct',
    date,
    amountCents: 8000,
    name: 'Shell',
    merchantName: null,
    createdAt: heldAt,
    ...fields,
  })

  it('pairs a held charge with the one charge in since its hold, dated that day to a week later', () => {
    const current = [
      charge('before', '2026-11-09'),
      charge('late', '2026-11-18'),
      charge('other-amount', '2026-11-12', { amountCents: 8001 }),
      charge('other-account', '2026-11-12', { accountId: 'elsewhere' }),
      charge('other-merchant', '2026-11-12', { name: 'Safeway' }),
      charge('kept-history', '2026-11-12', { createdAt: new Date('2026-11-01T00:00:00Z') }),
      charge('it', '2026-11-17'),
    ]
    expect(pairHeldCharges([pending()], current)).toEqual({
      pairs: new Map([['held-1', 'it']]),
      doubtful: [],
    })
  })

  it('finds a held charge doubtful when two charges could be it', () => {
    const current = [charge('a', '2026-11-10'), charge('b', '2026-11-11')]
    expect(pairHeldCharges([pending()], current)).toEqual({
      pairs: new Map(),
      doubtful: ['held-1'],
    })
  })

  it('finds both doubtful when two held charges could be the same one', () => {
    const held = [pending(), pending({ id: 'held-2', date: '2026-11-11', subject: 'p-2' })]
    expect(pairHeldCharges(held, [charge('a', '2026-11-12')])).toEqual({
      pairs: new Map(),
      doubtful: ['held-1', 'held-2'],
    })
  })

  it('leaves a held charge waiting while nothing could be it', () => {
    expect(pairHeldCharges([pending()], [])).toEqual({ pairs: new Map(), doubtful: [] })
  })
})

describe('sameMerchant', () => {
  const named = (name: string, merchantName: string | null = null) => ({ name, merchantName })

  it('matches on the first word of the merchant names', () => {
    expect(
      sameMerchant(named('BEST BUY 00012', 'Best Buy'), named('Best Buy', 'Best Buy Co')),
    ).toBe(true)
  })

  it('matches on the description when the bank gave no merchant name', () => {
    expect(sameMerchant(named('SHELL OIL 5741'), named('Shell'))).toBe(true)
    expect(sameMerchant(named('SHELL OIL 5741'), named('Shell Oil', 'Shell'))).toBe(true)
    expect(sameMerchant(named('Shell'), named('Safeway'))).toBe(false)
  })

  it('skips processor and bank words before the merchant', () => {
    expect(sameMerchant(named('POS PURCHASE SHELL'), named('Shell'))).toBe(true)
    expect(sameMerchant(named('PAYPAL *NETFLIX'), named('Netflix.com'))).toBe(true)
    expect(sameMerchant(named('SQ *BLUE BOTTLE'), named('SQ *CORNER BAKERY'))).toBe(false)
  })

  it('never matches text with no merchant word in it', () => {
    expect(sameMerchant(named('#1234'), named('#5678'))).toBe(false)
    expect(sameMerchant(named('POS DEBIT'), named('POS DEBIT'))).toBe(false)
  })
})

describe('a large charge after an account comes back', () => {
  const onNew = { providerAccountId: 'acc-savings-new' }
  const tv = { name: 'Best Buy', amountCents: 150_000, date: '2026-11-16' }

  const largeCharges = async () =>
    (
      await ctx.db.query<{ subject: string; push_state: string }>(
        `SELECT subject, push_state FROM notifications WHERE kind = 'large_transaction'`,
      )
    ).rows

  /** Links with the $1,500 charge on savings, notified and pushed, then un-ticks savings. */
  async function notifiedThenUnticked(pending: boolean): Promise<string> {
    const { connectionId } = await linkCheckingAndSavings()
    bank.pages = [
      page({
        added: [
          bankTx({
            ...tv,
            providerAccountId: 'acc-savings',
            providerTransactionId: 'ptx-tv',
            pending,
          }),
        ],
      }),
    ]
    await syncConnection(ctx, connectionId)
    await refreshInbox(ctx)
    await ctx.db.query(`UPDATE notifications SET push_state = 'sent', pushed_at = now()`)
    expect(await largeCharges()).toHaveLength(1)
    await untickSavings(connectionId)
    return connectionId
  }

  it('is not news again when it comes back under a new id', async () => {
    const connectionId = await notifiedThenUnticked(false)
    bank.accounts = [checking, { ...savings, ...onNew }]
    bank.pages = [page({ added: [bankTx({ ...tv, ...onNew, providerTransactionId: 'n-tv' })] })]
    await reconnected(ctx, connectionId)
    await refreshInbox(ctx)

    expect(await largeCharges()).toEqual([{ subject: 'n-tv', push_state: 'sent' }])
  })

  it.each([1, 2])(
    'is not news again when it was pending and posts %i syncs after the return',
    async (later) => {
      const connectionId = await notifiedThenUnticked(true)
      bank.accounts = [checking, { ...savings, ...onNew }]
      bank.pages = [page({})]
      await reconnected(ctx, connectionId)
      await refreshInbox(ctx)
      for (let sync = 1; sync <= later; sync++) {
        const arriving =
          sync === later ? [bankTx({ ...tv, ...onNew, providerTransactionId: 'n-tv' })] : []
        bank.pages = [page({ added: arriving })]
        await syncConnection(ctx, connectionId)
        await refreshInbox(ctx)
      }

      expect(await largeCharges()).toEqual([{ subject: 'n-tv', push_state: 'sent' }])
    },
  )

  it('is not news again when it was pending and comes back posted under a new id', async () => {
    const connectionId = await notifiedThenUnticked(true)
    bank.accounts = [checking, { ...savings, ...onNew }]
    bank.pages = [
      page({
        added: [bankTx({ ...tv, ...onNew, providerTransactionId: 'n-tv', date: '2026-11-17' })],
      }),
    ]
    await reconnected(ctx, connectionId)
    await refreshInbox(ctx)

    expect(await largeCharges()).toEqual([{ subject: 'n-tv', push_state: 'sent' }])
  })
})
