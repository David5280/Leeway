// Who Chat keeps out of what it sends a model: which transactions are one
// person paying another, which names are hidden because of them, and that a
// shop keeps its name everywhere, even one paid through PayPal. Every name
// here is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runChatTool } from '../src/chat/tools.js'
import { paymentPeople } from '../src/domain/chat/people.js'
import {
  isPersonPayment,
  namesIn,
  namesToHide,
  type PaymentNames,
} from '../src/domain/chat/personNames.js'
import type { Movement } from '../src/domain/transfers.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
const FROM_APPS = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'
const MARKETPLACE = 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'

/** A transaction as the rules read it: money out, with only what a case sets. */
const movement = (fields: Partial<Movement>): Movement => ({
  name: '',
  merchantName: null,
  amountCents: 2_000,
  providerCategoryPrimary: null,
  providerCategoryDetailed: null,
  ...fields,
})

describe('one person paying another', () => {
  it('through PayPal, needs a named person or Plaid code for an app payment', () => {
    const paypal = (fields: Partial<Movement>) =>
      isPersonPayment(movement({ name: 'PAYPAL INST XFER', ...fields }))
    // A bare transfer code is how PayPal pays shops too.
    expect(paypal({ merchantName: 'eBay', providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(false)
    expect(paypal({ providerCategoryPrimary: 'TRANSFER_OUT' })).toBe(false)
    expect(paypal({ merchantName: 'Quillon Marsh', providerCategoryDetailed: FROM_APPS })).toBe(
      true,
    )
    const named = movement({
      name: 'PAYPAL TRANSFER TO QUILLON MARSH',
      providerCategoryDetailed: ACCOUNT_TRANSFER,
    })
    expect(isPersonPayment(named)).toBe(true)
  })

  it('through Venmo, Cash App or Zelle, still takes any transfer code', () => {
    for (const name of ['VENMO PAYMENT', 'CASH APP*PAYMENT', 'ZELLE PAYMENT']) {
      const tx = movement({ name, merchantName: 'Ilsabet Quorn' })
      expect(isPersonPayment({ ...tx, providerCategoryDetailed: ACCOUNT_TRANSFER })).toBe(true)
      expect(isPersonPayment({ ...tx, providerCategoryDetailed: 'GENERAL_SERVICES_OTHER' })).toBe(
        false,
      )
    }
  })

  it('is never a shop paid through an app, or money that went through none', () => {
    expect(isPersonPayment(movement({ name: 'PAYPAL *SPOTIFY', merchantName: 'Spotify' }))).toBe(
      false,
    )
    const payroll = movement({ name: 'ACME CORP PAYROLL', amountCents: -250_000 })
    expect(isPersonPayment({ ...payroll, providerCategoryDetailed: 'TRANSFER_IN_DEPOSIT' })).toBe(
      false,
    )
  })

  it('shows its person under the name after "to", the merchant, and the bank line', () => {
    const tx = movement({ name: 'Zelle payment to JANE DOE 4417', merchantName: 'JANE DOE' })
    expect(namesIn(tx)).toEqual({
      person: ['Jane Doe', 'Jane Doe'],
      line: [expect.stringMatching(/jane doe/i)],
    })
    // A line that only says money moved names nobody.
    expect(namesIn(movement({ name: 'Online transfer' }))).toEqual({ person: [], line: [] })
  })
})

describe('the names Chat hides', () => {
  const found = (person: string[], line: string[] = []): PaymentNames => ({ person, line })

  it('are a person, their bank lines, and the first name they go by alone', () => {
    expect(namesToHide(found(['Jane Doe', 'Jane Doe'], ['Zelle To Jane Doe']), [])).toEqual([
      'Jane Doe',
      'Zelle To Jane Doe',
      'Jane',
    ])
  })

  it('never include a name a shop goes by, in any case', () => {
    expect(namesToHide(found(['eBay', 'Quillon Marsh'], ['EBAY']), ['Ebay', 'Spotify'])).toEqual([
      'Quillon Marsh',
      'Quillon',
    ])
  })

  it("leave a first name a shop has as a word, or one that isn't a given name", () => {
    const names = namesToHide(found(['Marigold Pettiwhistle', 'Online Fennwick', 'Tobias']), [
      "Marigold's Bakery",
    ])
    // "Online" says how money moved, and "Tobias" has no other name to stand apart from.
    expect(names).toEqual(['Marigold Pettiwhistle', 'Online Fennwick', 'Tobias'])
    expect(namesToHide(found(['J. Doe', "D'Arcy Vane"]), [])).toEqual([
      'J. Doe',
      "D'Arcy Vane",
      "D'Arcy",
    ])
  })
})

describe('what Chat sends about payments between people', () => {
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
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-15',
      name,
      amountCents,
      ...fields,
    })
    if (fields.note)
      await ctx.db.query('UPDATE transactions SET note = $1 WHERE id = $2', [fields.note, id])
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

  it('keeps eBay eBay everywhere when PayPal paid it by transfer', async () => {
    await pay('PAYPAL INST XFER', 4_500, { merchantName: 'eBay', detailed: ACCOUNT_TRANSFER })
    await pay('EBAY O*12-34567', 2_999, { merchantName: 'eBay', detailed: MARKETPLACE })

    expect(await paymentPeople(ctx.db)).toEqual({ names: [], transactionIds: new Set() })
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
    expect(await paymentPeople(ctx.db)).toEqual({ names: [], transactionIds: new Set([app]) })
    const merchants = merchantsOf(await sent('top_merchants'))
    expect(merchants).toContainEqual(expect.stringMatching(/^ebay$/i))
  })

  it('still hides a person paid through PayPal, and every app as before', async () => {
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

  it("hides a person's first name alone in a note, but not a shop that has it", async () => {
    await pay('Zelle payment to JANE DOE 4417', 5_000, { note: 'Dinner with Jane Doe and Jane' })
    await pay("MARIGOLD'S BAKERY", 1_800, {
      merchantName: "Marigold's Bakery",
      detailed: 'FOOD_AND_DRINK_BAKERIES',
      note: 'Cake for Jane',
    })
    await pay('Zelle payment to MARIGOLD PETTIWHISTLE', 2_000, {
      note: 'Marigold Pettiwhistle lunch',
    })

    const transactions = await sent('list_transactions')
    expect(transactions).toContain('Dinner with someone and someone')
    expect(transactions).toContain('Cake for someone')
    expect(transactions).toContain('someone lunch')
    expect(transactions).toContain("Marigold's Bakery")
    expect(transactions).not.toMatch(/jane|doe|pettiwhistle/i)
  })
})
