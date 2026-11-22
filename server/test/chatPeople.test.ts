// What Chat sends a model about payments between people, read from real
// rows through the tools: a payment row shows no person, the person's names
// are hidden everywhere else as the rules say, and shops, banks and the
// owner's own labels keep their names. Every name here is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runChatTool } from '../src/chat/tools.js'
import { NO_PEOPLE, paymentPeople } from '../src/domain/chat/people.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const FROM_APPS = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'
const MARKETPLACE = 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'
const GROCERIES = 'FOOD_AND_DRINK_GROCERIES'

let ctx: Awaited<ReturnType<typeof createTestContext>>
let accountId: string

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  ;({ accountId } = await insertBankAccount(ctx.db, { name: 'Chase Total Checking' }))
})

/** Adds a transaction this month, with an optional note from the owner. */
async function pay(
  name: string,
  amountCents: number,
  fields: { merchantName?: string; detailed?: string; note?: string } = {},
): Promise<string> {
  const { note, ...bank } = fields
  const id = await insertBankTransaction(ctx.db, accountId, {
    date: '2026-11-15',
    name,
    amountCents,
    ...bank,
  })
  if (note) await ctx.db.query('UPDATE transactions SET note = $1 WHERE id = $2', [note, id])
  return id
}

/** What the model is sent from a tool, with the people Chat found. */
async function sent(tool: string): Promise<string> {
  const people = await paymentPeople(ctx.db)
  const result = await runChatTool(ctx, { id: tool, name: tool, input: {} }, people, (error) => {
    throw error
  })
  expect(result.isError).toBe(false)
  return result.content
}

type SentTransaction = { displayName: string; note: string | null }
const transactionsOf = async () =>
  (JSON.parse(await sent('list_transactions')) as { transactions: SentTransaction[] }).transactions
const notesOf = async () => (await transactionsOf()).flatMap((tx) => (tx.note ? [tx.note] : []))
const merchantsOf = async () =>
  (JSON.parse(await sent('top_merchants')) as { merchant: string }[]).map((total) => total.merchant)

describe('a shop paid through PayPal', () => {
  it('keeps eBay eBay everywhere when PayPal paid it by transfer', async () => {
    await pay('PAYPAL INST XFER', 4_500, { merchantName: 'eBay', detailed: ACCOUNT_TRANSFER })
    await pay('EBAY O*12-34567', 2_999, { merchantName: 'eBay', detailed: MARKETPLACE })

    expect(await paymentPeople(ctx.db)).toBe(NO_PEOPLE)
    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/someone/i)
    expect(transactions.match(/ebay/gi)!.length).toBeGreaterThanOrEqual(2)
    expect(await merchantsOf()).toEqual([expect.stringMatching(/^ebay$/i)])
  })

  it('keeps a shop its name even when Plaid files a payment to it as from an app', async () => {
    const app = await pay('PAYPAL INST XFER', 4_500, { merchantName: 'eBay', detailed: FROM_APPS })
    await pay('EBAY O*12-34567', 2_999, { merchantName: 'eBay', detailed: MARKETPLACE })

    // The app payment itself shows no one, but eBay is no person to hide elsewhere.
    expect(await paymentPeople(ctx.db)).toEqual({
      names: [],
      loneNames: [],
      transactionIds: new Set([app]),
    })
    expect(await merchantsOf()).toContainEqual(expect.stringMatching(/^ebay$/i))
  })

  it('hides a person PayPal paid by bare transfer, whose merchant is no shop', async () => {
    await pay('PAYPAL INST XFER', 6_000, {
      merchantName: 'Quillon Marsh',
      detailed: ACCOUNT_TRANSFER,
      note: 'owed Quillon Marsh',
    })
    await pay('KING SOOPERS', 3_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'QUILLON came too',
    })

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/quillon|marsh/i)
    expect(await notesOf()).toEqual(['someone came too'])
  })
})

describe('a person paid through an app', () => {
  it('is hidden through PayPal, Venmo, Cash App and Zelle, while shops and pay stay', async () => {
    await pay('PAYPAL TRANSFER TO QUILLON MARSH', 6_000, { detailed: ACCOUNT_TRANSFER })
    await pay('VENMO PAYMENT', 2_500, { merchantName: 'Ilsabet Quorn', detailed: ACCOUNT_TRANSFER })
    await pay('CASH APP*TOBIAS FENNWICK', 1_500, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle payment to ROSALIND FAIRWEATHER JPM99A1B2C3', 3_100)
    await pay('PAYPAL *SPOTIFY', 1_199, {
      merchantName: 'Spotify',
      detailed: 'ENTERTAINMENT_MUSIC',
    })
    await pay('ACME CORP PAYROLL', -250_000, { detailed: 'INCOME_WAGES' })

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(
      /quillon|marsh|ilsabet|quorn|tobias|fennwick|rosalind|fairweather/i,
    )
    expect(transactions.match(/"To someone"/g)).toHaveLength(4)
    expect(transactions).toMatch(/spotify/i)
    expect(transactions).toMatch(/payroll/i)
    const merchants = await merchantsOf()
    expect(merchants).toContain('Payment app')
    expect(merchants).toContainEqual(expect.stringMatching(/spotify/i))
  })

  it('stays hidden when money in is filed under their name as income', async () => {
    await pay('Zelle payment from MARIA SILVA 99X', -50_000, {
      detailed: 'TRANSFER_IN_TRANSFER_IN_FROM_APPS',
      note: 'Help from Maria Silva',
    })
    await pay('ZELLE 8473 CONF', -40_000, {
      merchantName: 'Maria Silva',
      detailed: 'INCOME_OTHER_INCOME',
    })
    await pay('KING SOOPERS', 3_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Lunch with Maria Silva',
    })

    expect(await sent('list_transactions')).not.toMatch(/maria|silva/i)
    // The payment's own note is dropped; a note elsewhere loses the name.
    expect(await notesOf()).toEqual(['Lunch with someone'])
  })

  it('stays hidden when rent paid by check is filed under their name', async () => {
    await pay('Zelle payment to JOHN SMITH JPM1', 150_000, { detailed: ACCOUNT_TRANSFER })
    await pay('CHECK 1043', 150_000, {
      merchantName: 'John Smith',
      detailed: 'RENT_AND_UTILITIES_RENT',
      note: 'Rent to John Smith',
    })

    expect(await sent('list_transactions')).not.toMatch(/john|smith/i)
    expect(await notesOf()).toEqual(['Rent to someone'])
    expect(await merchantsOf()).not.toContainEqual(expect.stringMatching(/john|smith/i))
  })

  it('stays hidden when a Venmo payment is filed under their name as a service', async () => {
    await pay('VENMO 1234567', 4_000, {
      merchantName: 'Tobias Fennwick',
      detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      note: 'Tobias Fennwick and Tobias',
    })
    await pay('Zelle payment to TOBIAS FENNWICK', 2_000)

    expect(await sent('list_transactions')).not.toMatch(/tobias|fennwick/i)
    expect(await notesOf()).toEqual(['someone and someone'])
    expect(await merchantsOf()).not.toContainEqual(expect.stringMatching(/tobias|fennwick/i))
  })

  it('is hidden when named only in the bank line, or before a memo', async () => {
    await pay('Zelle Transfer Conf# T0ABCD123; Jane Doe', 2_000, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle payment to ILSABET QUORN for "concert tickets"', 4_000)
    await pay('ZELLE TO VANTERPOOL SKYE FOR DINNER', 3_000)
    await pay('KING SOOPERS', 3_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Snacks for Jane Doe, Ilsabet Quorn and SKYE',
    })

    const transactions = await transactionsOf()
    expect(JSON.stringify(transactions)).not.toMatch(/jane|doe|ilsabet|quorn|vanterpool|skye/i)
    expect(transactions.filter((tx) => tx.displayName === 'To someone')).toHaveLength(3)
    expect(await notesOf()).toEqual(['Snacks for someone, someone and someone'])
  })
})

describe('a name of one word', () => {
  it('never blanks out a bill, a category, an account or a merchant that shares it', async () => {
    for (const person of ['BILL', 'RENT', 'WILL', 'CHASE'])
      await pay(`Zelle payment to ${person}`, 1_000)
    await pay('CHASE CREDIT CRD AUTOPAY', 30_000, { detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })
    await ctx.db.query(
      `INSERT INTO categories (name, color, kind, position) VALUES ('Rent', '#000000', 'expense', 90)`,
    )
    await ctx.db.query(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern)
       VALUES ('Water bill', 4000, 'month', '2026-11-20', 'denver water')`,
    )

    const transactions = await sent('list_transactions')
    expect(transactions.match(/"To someone"/g)).toHaveLength(4)
    expect(transactions).toMatch(/"Chase[^"]*Autopay"/i)
    expect(await sent('list_categories')).toContain('"Rent"')
    expect(await sent('list_bills')).toContain('"Water bill"')
    expect(await sent('summarize_accounts')).toContain('Chase Total Checking')
    const merchants = await merchantsOf()
    expect(merchants.filter((merchant) => merchant === 'Payment app')).toHaveLength(4)
    expect(merchants).toContainEqual(expect.stringMatching(/^chase/i))
  })
})

describe('the owner’s own labels', () => {
  it('lose a full name, but keep a single word of it', async () => {
    await pay('Zelle payment to JANE DOE', 5_000)
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Gifts for Jane Doe', '#000000', 'expense', 90), ('Jane allowance', '#000000', 'expense', 91)
       RETURNING id`,
    )
    await ctx.db.query(
      `INSERT INTO goals (name, target_cents) VALUES ('Trip with JANE DOE', 90000), ('Jane''s party', 5000)`,
    )
    await ctx.db.query(
      `INSERT INTO rules (field, match_type, pattern, category_id, position)
       VALUES ('description', 'contains', 'jane doe', $1, 0), ('description', 'contains', 'Jane', $1, 1)`,
      [rows[0]!.id],
    )

    const categories = await sent('list_categories')
    expect(categories).toContain('"Gifts for someone"')
    expect(categories).toContain('"Jane allowance"')
    const goals = await sent('list_goals')
    expect(goals).toContain('"Trip with someone"')
    expect(goals).toContain(`"Jane's party"`)
    const rules = await sent('list_rules')
    expect(rules).not.toMatch(/jane doe/i)
    expect(rules).toContain('"Jane"')
  })
})

describe('a sole trader also paid through an app', () => {
  it('keeps the shop its purchases, never merged with the payment to the person', async () => {
    const payment = await pay('VENMO PAYMENT', 2_500, {
      merchantName: 'Rosalind Fairweather',
      detailed: ACCOUNT_TRANSFER,
      note: 'Rosalind for the cake',
    })
    await pay('SQ *ROSALIND FAIRWEATHER', 4_000, {
      merchantName: 'Rosalind Fairweather',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
    })

    const transactions = await transactionsOf()
    expect(transactions).toContainEqual(
      expect.objectContaining({ displayName: 'To someone', note: null }),
    )
    expect(transactions).toContainEqual(
      expect.objectContaining({ displayName: 'Rosalind Fairweather' }),
    )
    expect((await paymentPeople(ctx.db)).transactionIds).toEqual(new Set([payment]))
    const totals = JSON.parse(await sent('top_merchants')) as {
      merchant: string
      spentCents: number
    }[]
    expect(totals).toEqual([
      expect.objectContaining({ merchant: 'Rosalind Fairweather', spentCents: 4_000 }),
      expect.objectContaining({ merchant: 'Payment app', spentCents: 2_500, betweenPeople: true }),
    ])
  })
})

describe("a person's name alone in a note", () => {
  it('is hidden by any word of the name, with a capital or in capitals, accents aside', async () => {
    await pay('Zelle payment to JANE DOE 4417', 5_000)
    await pay('Zelle payment to José María Núñez', 2_000)
    await pay('Zelle payment to WENDY PARK', 2_000)
    const shop = { merchantName: 'King Soopers', detailed: GROCERIES }
    await pay('KING SOOPERS', 100, { ...shop, note: "JANE DOE's; jane-doe; Doe, Jane; DOE; Q" })
    await pay('KING SOOPERS', 200, {
      ...shop,
      note: 'Dinner with NUNEZ JOSE and María; jane stays',
    })
    await pay("WENDY'S #812", 1_100, {
      merchantName: "Wendy's",
      detailed: 'FOOD_AND_DRINK_FAST_FOOD',
      note: 'Paid Wendy back',
    })

    expect((await notesOf()).sort()).toEqual([
      'Dinner with someone someone and someone; jane stays',
      // "Wendy's" has more attached, so it is not how the person is called.
      'Paid someone back',
      "someone's; someone; someone, someone; someone; Q",
    ])
  })

  it('never hides an everyday word, a month or a bank', async () => {
    for (const person of ['BILL JONES', 'WILL TURNER', 'MAY CHEN', 'CHASE MILLER']) {
      await pay(`Zelle payment to ${person}`, 1_000)
    }
    await pay('XCEL ENERGY', 9_000, {
      merchantName: 'Xcel Energy',
      detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
      note: 'Electric bill, will pay May 3',
    })
    await pay('CHASE CREDIT CRD AUTOPAY', 30_000, {
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      note: 'Chase card, Bill it, JONES too',
    })

    const transactions = await sent('list_transactions')
    expect((await notesOf()).sort()).toEqual([
      'Chase card, Bill it, someone too',
      'Electric bill, will pay May 3',
    ])
    expect(transactions).not.toMatch(/jones|turner|chen|miller/i)
    const merchants = await merchantsOf()
    expect(merchants.filter((merchant) => merchant === 'Payment app')).toHaveLength(4)
    expect(merchants).toContainEqual(expect.stringMatching(/^chase/i))
    expect(merchants).toContainEqual(expect.stringMatching(/^xcel energy$/i))
  })

  it('stays when a shop is called by it', async () => {
    await pay('Zelle payment to MARIGOLD PETTIWHISTLE', 2_000)
    await pay('MARIGOLD BAKERY', 1_800, {
      merchantName: 'Marigold Bakery',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
      note: 'Cake from Marigold for Pettiwhistle',
    })
    // A check card purchase is a real purchase, so it vouches for its shop.
    await pay('VENMO PAYMENT', 700, { merchantName: 'Quorn Florist', detailed: ACCOUNT_TRANSFER })
    await pay('CHECK CARD PURCHASE QUORN FLORIST', 900, {
      merchantName: 'Quorn Florist',
      detailed: 'GENERAL_MERCHANDISE_OTHER',
    })

    const transactions = await sent('list_transactions')
    expect(await notesOf()).toEqual(['Cake from Marigold for someone'])
    expect(transactions).toContain('Marigold Bakery')
    expect(transactions).toContain('Quorn Florist')
  })
})
