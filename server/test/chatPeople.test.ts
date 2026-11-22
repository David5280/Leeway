// What Chat sends a model about payments between people, read from real
// rows: a person is hidden everywhere, alone in a note too, and a shop keeps
// its name, even one paid through PayPal. Every name here is made up.

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
  ;({ accountId } = await insertBankAccount(ctx.db, { name: 'Checking' }))
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

const merchantsOf = (content: string) =>
  (JSON.parse(content) as { merchant: string }[]).map((total) => total.merchant)
const notesOf = (content: string) =>
  (JSON.parse(content) as { transactions: { note: string | null }[] }).transactions.flatMap((tx) =>
    tx.note ? [tx.note] : [],
  )

describe('a shop paid through PayPal', () => {
  it('keeps eBay eBay everywhere when PayPal paid it by transfer', async () => {
    await pay('PAYPAL INST XFER', 4_500, { merchantName: 'eBay', detailed: ACCOUNT_TRANSFER })
    await pay('EBAY O*12-34567', 2_999, { merchantName: 'eBay', detailed: MARKETPLACE })

    expect(await paymentPeople(ctx.db)).toBe(NO_PEOPLE)
    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/someone/i)
    expect(transactions.match(/ebay/gi)!.length).toBeGreaterThanOrEqual(2)
    expect(merchantsOf(await sent('top_merchants'))).toContainEqual(
      expect.stringMatching(/^ebay$/i),
    )
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
    expect(merchantsOf(await sent('top_merchants'))).toContainEqual(
      expect.stringMatching(/^ebay$/i),
    )
  })

  it('hides a person PayPal paid by bare transfer, whose merchant is no shop', async () => {
    await pay('PAYPAL INST XFER', 6_000, {
      merchantName: 'Quillon Marsh',
      detailed: ACCOUNT_TRANSFER,
      note: 'owed Quillon Marsh, Quillon says thanks',
    })

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/quillon|marsh/i)
    expect(notesOf(transactions)).toEqual(['owed someone, someone says thanks'])
    expect(transactions).toContain('"To someone"')
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
    const merchants = merchantsOf(await sent('top_merchants'))
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

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/maria|silva/i)
    expect(notesOf(transactions)).toEqual(['Help from someone'])
  })

  it('stays hidden when rent paid by check is filed under their name', async () => {
    await pay('Zelle payment to JOHN SMITH JPM1', 150_000, {
      detailed: ACCOUNT_TRANSFER,
      note: 'Rent to John Smith',
    })
    await pay('CHECK 1043', 150_000, {
      merchantName: 'John Smith',
      detailed: 'RENT_AND_UTILITIES_RENT',
    })

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/john|smith/i)
    expect(notesOf(transactions)).toEqual(['Rent to someone'])
    expect(merchantsOf(await sent('top_merchants'))).not.toContainEqual(
      expect.stringMatching(/john|smith/i),
    )
  })

  it('stays hidden when a Venmo payment is filed under their name as a service', async () => {
    await pay('VENMO 1234567', 4_000, {
      merchantName: 'Tobias Fennwick',
      detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
    })
    await pay('Zelle payment to TOBIAS FENNWICK', 2_000, { note: 'Tobias Fennwick and Tobias' })

    const transactions = await sent('list_transactions')
    expect(transactions).not.toMatch(/tobias|fennwick/i)
    expect(notesOf(transactions)).toEqual(['someone and someone'])
    expect(merchantsOf(await sent('top_merchants'))).not.toContainEqual(
      expect.stringMatching(/tobias|fennwick/i),
    )
  })
})

describe("a person's name alone", () => {
  it('is hidden in a note by given name or surname, however the full name is written', async () => {
    await pay('Zelle payment to JANE DOE 4417', 5_000, { note: 'Dinner with Jane Doe and Jane' })
    await pay('Zelle payment to WENDY PARK', 2_000, { note: "JANE DOE's; jane-doe; Doe, Jane" })
    await pay("WENDY'S #812", 1_100, {
      merchantName: "Wendy's",
      detailed: 'FOOD_AND_DRINK_FAST_FOOD',
      note: 'Paid Wendy back',
    })

    const notes = notesOf(await sent('list_transactions'))
    expect(notes).toContain('Dinner with someone and someone')
    expect(notes).toContain("someone's; someone; someone, someone")
    // "Wendy's" has more attached, so it is not how the person is called.
    expect(notes).toContain('Paid someone back')
  })

  it('never hides an everyday word, a month or a bank, in a note or anywhere else', async () => {
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
      note: 'Chase card, Bill it',
    })

    const transactions = await sent('list_transactions')
    expect(notesOf(transactions).sort()).toEqual([
      'Chase card, Bill it',
      'Electric bill, will pay May 3',
    ])
    expect(transactions).toMatch(/"Chase[^"]*"/)
    expect(transactions).not.toMatch(/jones|turner|chen|miller/i)
    const merchants = merchantsOf(await sent('top_merchants'))
    // One total for each person paid, and the card payment and the bill keep their names.
    expect(merchants.filter((merchant) => merchant === 'Payment app')).toHaveLength(4)
    expect(merchants).toContainEqual(expect.stringMatching(/^chase/i))
    expect(merchants).toContainEqual(expect.stringMatching(/^xcel energy$/i))
  })

  it('stays when a shop is called by it', async () => {
    await pay('Zelle payment to MARIGOLD PETTIWHISTLE', 2_000, {
      note: 'Marigold Pettiwhistle lunch, then Pettiwhistle left',
    })
    await pay('MARIGOLD BAKERY', 1_800, {
      merchantName: 'Marigold Bakery',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
      note: 'Cake from Marigold',
    })

    const transactions = await sent('list_transactions')
    expect(notesOf(transactions).sort()).toEqual([
      'Cake from Marigold',
      'someone lunch, then someone left',
    ])
    expect(transactions).toContain('Marigold Bakery')
  })
})
