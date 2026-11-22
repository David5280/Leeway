// What Chat sends a model about transfers and lines it cannot vouch for,
// read from real rows through the tools: a transfer or payment to or from
// someone reads as its kind, a line with no code that is no known shop
// reads as a purchase or payment, and the names in them are hidden
// elsewhere, while the owner's own accounts keep theirs. Every name is made up.

import { describe, expect, it } from 'vitest'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { recategorize } from '../src/domain/categorize.js'
import { paymentPeople } from '../src/domain/chat/people.js'
import { insertBankAccount, insertBankTransaction } from './helpers.js'
import { ACCOUNT_TRANSFER, GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe
const transfer = { detailed: ACCOUNT_TRANSFER }

describe('a bank transfer', () => {
  it('reads as its kind by its code, keeping its note with names hidden', async () => {
    const lines = [
      'ONLINE TRANSFER TO THORNBURY C EVERYDAY CHECKING XXXXXX9081 REF #IBEXYZ ON 11/15/26',
      'Online Transfer to Clara Thornbury',
      'ONLINE TRANSFER TO LANDLORD PROPERTY MGMT',
      'Online Banking transfer to CHK 1234 Confirmation# 999',
    ]
    for (const line of lines) await pay(line, 10_000, { ...transfer, note: 'Clara rent share' })
    await pay('ONLINE TRANSFER TO WEALTHFRONT', 5_000, {
      detailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    await pay('ONLINE TRANSFER FROM ALLY SAVINGS', -5_000, { detailed: 'TRANSFER_IN_SAVINGS' })

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(
      /thornbury|clara|landlord|chk|wealthfront|ally/i,
    )
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'Transfer from savings',
      ...lines.map(() => 'Transfer to another account'),
      'Transfer to investments',
    ])
    expect(await probe.notes()).toEqual(lines.map(() => 'someone rent share'))
  })

  it('reads as a payment however a bank abbreviates it, under any code or none', async () => {
    await pay('XFER TO JANE OSTROVSKA', 1_000)
    await pay('TRNSFR FROM JANE PENWARDEN', -1_000)
    await pay('MOBILE TRANSFER TO JANE ARKWRIGHT', 1_000, transfer)
    await pay('Online Payment 18334 To Bertram Quillfeather', 150_000, {
      detailed: 'RENT_AND_UTILITIES_RENT',
    })
    await probe.ctx.db.query(
      `INSERT INTO categories (name, color, kind, position) VALUES ('Quillfeather rent', '#000000', 'expense', 90)`,
    )

    const transactions = await probe.transactions()
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'Payment received',
      'Payment sent',
      'Rent payment',
      'Transfer to another account',
    ])
    const everything = [await probe.sent('list_transactions'), await probe.sent('list_categories')]
    expect(everything.join()).not.toMatch(/ostrovska|penwarden|arkwright|bertram|quillfeather/i)
    expect((await probe.merchants()).sort()).toEqual([
      'Payment sent',
      'Rent payment',
      'Transfer to another account',
    ])
  })

  it("hides no word of the owner's own accounts, which keep their names", async () => {
    await insertBankAccount(probe.ctx.db, { name: 'Ally Savings' })
    await pay('ONLINE TRANSFER TO ALLY SAVINGS', 10_000, transfer)
    await pay('Online Transfer to Chase Checking', 10_000, transfer)
    await pay('KING SOOPERS', 900, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Moved the rest to Ally Savings and Chase Checking',
    })

    expect(await paymentPeople(probe.ctx.db)).toMatchObject({
      names: [],
      loneNames: [],
      loneAnyCase: [],
    })
    expect(await probe.notes()).toEqual(['Moved the rest to Ally Savings and Chase Checking'])
    expect(await probe.sent('list_accounts')).toMatch(/Ally Savings.*|Chase Total Checking/)
  })

  it("keeps the names of a transfer paired between two of the owner's accounts", async () => {
    await createCategory(
      probe.ctx.db,
      categoryInputSchema.parse({ name: 'Transfers', kind: 'transfer' }),
    )
    const { accountId: savings } = await insertBankAccount(probe.ctx.db, { name: 'Ally Savings' })
    await pay('ONLINE TRANSFER TO ALLY BANK SAVINGS', 10_000, transfer)
    await insertBankTransaction(probe.ctx.db, savings, {
      date: '2026-11-15',
      name: 'ONLINE TRANSFER FROM CHASE',
      amountCents: -10_000,
      detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    })
    await recategorize(probe.ctx.db)

    const paired = 'Test Chase Total Checking to Test Ally Savings'
    expect((await probe.transactions()).map((tx) => tx.displayName)).toEqual([paired, paired])
  })
})

describe('a line with no code, as an import brings', () => {
  it('reads as an app or a purchase, but leaves the name of a shop the owner buys from', async () => {
    await pay('ZELLE SENT JANE PRYCEWOOD', 2_000, { note: 'Jane Prycewood dinner' })
    await pay('Venmo Jane Halloway', 1_500)
    await pay('PAYPAL *JANEFOXHALL', 1_000)
    await pay('JANE MOSSGIEL', 3_000)
    await pay('MARIGOLD CAFE 0042', 700)
    await pay('MARIGOLD CAFE', 600, {
      merchantName: 'Marigold Cafe',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })
    await pay('KING SOOPERS', 900, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Halloway, Prycewood and JANEFOXHALL; Jane Mossgiel came',
    })

    const transactions = await probe.transactions()
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'King Soopers',
      'Marigold Cafe',
      'PayPal payment (sent)',
      'Purchase or payment',
      'Purchase or payment',
      'Venmo payment (sent)',
      'Zelle payment (sent)',
    ])
    // A name read from a line with no code is hidden like any other.
    expect(await probe.notes()).toEqual(['someone, someone and someone; someone came'])
    expect(JSON.stringify(transactions)).not.toMatch(/prycewood|halloway|foxhall|mossgiel/i)
  })

  it('shows what the owner typed in by hand only as a shop or in everyday words', async () => {
    const typed = async (name: string, amountCents: number) =>
      probe.ctx.db.query(
        `INSERT INTO transactions (account_id, date, name, amount_cents) VALUES ($1, '2026-11-15', $2, $3)`,
        [probe.accountId, name, amountCents],
      )
    for (const [name, cents] of [
      ['Jane Doe babysitting', 6_000],
      ['Rent to John Smith', 150_000],
      ['Rent', 1_000],
      ['House cleaner', 9_000],
      ['King Soopers', 2_000],
    ] as const) {
      await typed(name, cents)
    }
    await pay('KING SOOPERS', 900, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Jane Doe came, and SMITH',
    })

    const transactions = await probe.transactions()
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'House cleaner',
      'King Soopers',
      'King Soopers',
      'Purchase or payment',
      'Purchase or payment',
      'Rent',
    ])
    expect(await probe.notes()).toEqual(['someone came, and someone'])
    const totals = await probe.sent('top_merchants', { limit: 50 })
    expect(totals).toContain('"merchant":"King Soopers","spentCents":2900')
    for (const tool of ['list_transactions', 'top_merchants', 'get_summary', 'find_recurring']) {
      expect([tool, await probe.sent(tool)]).not.toEqual([
        tool,
        expect.stringMatching(/jane|doe|smith/i),
      ])
    }
  })
})
