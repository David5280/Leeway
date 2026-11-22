// What Chat sends a model about payments through an app, read from real rows
// through the tools: the payment reads as its app and direction, its note
// and person go, the person's names are hidden everywhere else, and shops,
// banks and the owner's own labels keep their names. Bank transfers are in
// chatTransfers.test.ts. Every name is made up.

import { describe, expect, it } from 'vitest'
import { NO_PEOPLE, paymentPeople } from '../src/domain/chat/people.js'
import { ACCOUNT_TRANSFER, GROCERIES, useChatProbe } from './chatProbe.js'

const FROM_APPS = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'
const MARKETPLACE = 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'
const probe = useChatProbe()
const { pay } = probe

describe('a shop paid through PayPal', () => {
  it('keeps its name when the owner buys there, however Plaid filed the payment', async () => {
    await pay('PAYPAL INST XFER', 4_500, { merchantName: 'eBay', detailed: ACCOUNT_TRANSFER })
    await pay('PAYPAL INST XFER', 1_500, { merchantName: 'eBay', detailed: FROM_APPS })
    await pay('EBAY O*12-34567', 2_999, { merchantName: 'eBay', detailed: MARKETPLACE })

    expect(await paymentPeople(probe.ctx.db)).toBe(NO_PEOPLE)
    const transactions = await probe.sent('list_transactions')
    expect(transactions).not.toMatch(/someone|payment \(sent\)/i)
    expect(await probe.merchants()).toEqual([expect.stringMatching(/^ebay$/i)])
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

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(/quillon|marsh/i)
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'King Soopers',
      'PayPal payment (sent)',
    ])
    expect(await probe.notes()).toEqual(['someone came too'])
  })
})

describe('a person paid through an app', () => {
  it('reads as the app, through PayPal, Venmo, Cash App and Zelle, while shops and pay stay', async () => {
    await pay('PAYPAL TRANSFER TO QUILLON MARSH', 6_000, { detailed: ACCOUNT_TRANSFER })
    await pay('VENMO PAYMENT', 2_500, { merchantName: 'Ilsabet Quorn', detailed: ACCOUNT_TRANSFER })
    await pay('CASH APP*TOBIAS FENNWICK', 1_500, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle payment to ROSALIND FAIRWEATHER JPM99A1B2C3', 3_100)
    await pay('Zelle payment from MARIA SILVA', -2_000, { detailed: 'INCOME_OTHER_INCOME' })
    await pay('SPOTIFY USA', 1_199, { merchantName: 'Spotify', detailed: 'ENTERTAINMENT_MUSIC' })
    await pay('PAYPAL *SPOTIFY', 1_199, {
      merchantName: 'Spotify',
      detailed: 'ENTERTAINMENT_MUSIC',
    })
    await pay('ACME CORP PAYROLL', -250_000, { detailed: 'INCOME_WAGES' })

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(
      /quillon|marsh|ilsabet|quorn|tobias|fennwick|rosalind|fairweather|maria|silva/i,
    )
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'Acme Corp Payroll',
      'Cash App payment (sent)',
      'PayPal payment (sent)',
      'Spotify',
      'Spotify',
      'Venmo payment (sent)',
      'Zelle payment (received)',
      'Zelle payment (sent)',
    ])
    expect(await probe.merchants()).toEqual([
      'PayPal payment (sent)',
      'Zelle payment (sent)',
      'Venmo payment (sent)',
      'Spotify',
      'Cash App payment (sent)',
    ])
  })

  it('drops its note, and its names go from every other note and the line of any row', async () => {
    await pay('ZELLE 8473 CONF', -40_000, {
      merchantName: 'Maria Silva',
      detailed: 'INCOME_OTHER_INCOME',
      note: 'Help from Maria',
    })
    await pay('Zelle payment to JOHN SMITH JPM1', 150_000, { detailed: ACCOUNT_TRANSFER })
    await pay('CHECK 1043', 150_000, {
      merchantName: 'John Smith',
      detailed: 'RENT_AND_UTILITIES_RENT',
      note: 'Rent to John',
    })
    await pay('KING SOOPERS', 3_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Lunch with maria and SMITH',
    })

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(/maria|silva|john|smith/i)
    expect((await probe.notes()).sort()).toEqual([
      'Lunch with someone and someone',
      'Rent to someone',
    ])
  })

  it('is read from the line, the memo and the merchant, however the bank wrote them', async () => {
    await pay('Zelle Transfer Conf# T0ABCD123; Halvorsen, Ingrid', 2_000, {
      detailed: ACCOUNT_TRANSFER,
    })
    await pay('ZELLE TO DUNMORE PERPETUA ON 11/15 REF # PP0ABC', 3_000)
    await pay('Zelle payment to ILSABET QUORN for "concert tickets"', 4_000)
    await pay('Zelle from Ambrose Kettering to CHASE CHECKING', -3_000)
    await pay('Payment to Wilhelmina Ashcombe via Zelle', 1_000)
    await pay('Zelle payment to Jane Corrigan Cash App', 1_000)
    await pay('KING SOOPERS', 3_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Ingrid Halvorsen, Perpetua Dunmore, Quorn, Kettering, Wilhelmina and corrigan',
    })

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(
      /ingrid|halvorsen|dunmore|perpetua|ilsabet|quorn|ambrose|kettering|wilhelmina|ashcombe|corrigan/i,
    )
    expect(await probe.notes()).toEqual(['someone, someone, someone, someone, someone and someone'])
    // Money in arrived in the owner's own account, which keeps its name.
    expect(await probe.sent('summarize_accounts')).toContain('Chase Total Checking')
  })

  it('shows no person through a short or unnamed app either', async () => {
    const transfer = { detailed: ACCOUNT_TRANSFER, note: 'Lunch with Mirabel' }
    await pay('SENT MONEY TO PELLWORTH ODA', 2_000, transfer)
    await pay('ZEL TO MIRABEL QUINT', 3_000, transfer)

    const transactions = await probe.transactions()
    expect(JSON.stringify(transactions)).not.toMatch(/pellworth|oda\b|mirabel|quint/i)
    expect(transactions.map((tx) => tx.displayName).sort()).toEqual([
      'Payment app (sent)',
      'Zelle payment (sent)',
    ])
    expect(await probe.notes()).toEqual([])
  })
})

describe('a name of one word that is also a word', () => {
  it('goes from notes only, so a bill, a category, an account and a merchant keep it', async () => {
    for (const person of ['BILL', 'RENT', 'WILL', 'CHASE'])
      await pay(`Zelle payment to ${person}`, 1_000)
    await pay('CHASE CREDIT CRD AUTOPAY', 30_000, {
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      note: 'Chase card, Bill it, Will paid',
    })
    await probe.ctx.db.query(
      `INSERT INTO categories (name, color, kind, position) VALUES ('Rent', '#000000', 'expense', 90)`,
    )
    await probe.ctx.db.query(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern)
       VALUES ('Water bill', 4000, 'month', '2026-11-20', 'denver water')`,
    )

    const transactions = await probe.transactions()
    expect(transactions.filter((tx) => tx.displayName === 'Zelle payment (sent)')).toHaveLength(4)
    expect(transactions).toContainEqual(
      expect.objectContaining({ displayName: expect.stringMatching(/^chase/i) }),
    )
    expect(await probe.notes()).toEqual(['someone card, someone it, someone paid'])
    expect(await probe.sent('list_categories')).toContain('"Rent"')
    expect(await probe.sent('list_bills')).toContain('"Water bill"')
    expect(await probe.sent('summarize_accounts')).toContain('Chase Total Checking')
  })
})

describe('the owner’s own labels', () => {
  it('lose a full name and a word of it, but keep the shop a word names', async () => {
    await pay('Zelle payment to JANE DOE', 5_000)
    await pay('Zelle payment to LEOPOLD MARCHETTI', 5_000)
    await pay('BLACKWOOD BAKERY', 900, {
      merchantName: 'Blackwood Bakery',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
    })
    await pay('Zelle payment to IGNATIUS BLACKWOOD', 5_000)
    const { rows } = await probe.ctx.db.query<{ id: string }>(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Gifts for Jane Doe', '#000000', 'expense', 90), ('Marchetti wedding', '#000000', 'expense', 91),
         ('Blackwood treats', '#000000', 'expense', 92)
       RETURNING id`,
    )
    await probe.ctx.db.query(
      `INSERT INTO goals (name, target_cents) VALUES ('Trip with JANE DOE', 90000), ('Jane''s party', 5000)`,
    )
    await probe.ctx.db.query(
      `INSERT INTO rules (field, match_type, pattern, category_id, position)
       VALUES ('description', 'contains', 'jane doe', $1, 0), ('description', 'contains', 'Leopold', $1, 1)`,
      [rows[0]!.id],
    )

    const categories = await probe.sent('list_categories')
    expect(categories).toContain('"Gifts for someone"')
    expect(categories).toContain('"someone wedding"')
    expect(categories).toContain('"Blackwood treats"')
    const goals = await probe.sent('list_goals')
    expect(goals).toContain('"Trip with someone"')
    expect(goals).toContain(`"someone's party"`)
    expect(await probe.sent('list_rules')).not.toMatch(/jane|doe|leopold/i)
    expect(await probe.sent('export_config')).not.toMatch(/jane|doe|leopold|marchetti/i)
  })
})

describe('a sole trader also paid through an app', () => {
  it('reads as the shop the owner buys from, which shows no one new', async () => {
    await pay('VENMO PAYMENT', 2_500, {
      merchantName: 'Rosalind Fairweather',
      detailed: ACCOUNT_TRANSFER,
    })
    await pay('SQ *ROSALIND FAIRWEATHER', 4_000, {
      merchantName: 'Rosalind Fairweather',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
    })

    expect(await paymentPeople(probe.ctx.db)).toBe(NO_PEOPLE)
    const transactions = await probe.transactions()
    expect(transactions.map((tx) => tx.displayName)).toEqual([
      'Rosalind Fairweather',
      'Rosalind Fairweather',
    ])
    expect(JSON.parse(await probe.sent('top_merchants'))).toEqual([
      { merchant: 'Rosalind Fairweather', spentCents: 6_500, count: 2 },
    ])
  })
})

describe('a payment app paying a card or the owner', () => {
  it('reads as the app, and hides no name of the owner or their card elsewhere', async () => {
    await pay('Online Payment to Venmo Credit Card', 12_000, {
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    await pay('Transfer from Venmo', -4_000, {
      detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
      note: 'cashout',
    })
    await pay('VENMO ADD FUNDS', 5_000, { detailed: ACCOUNT_TRANSFER })
    await pay('KING SOOPERS', 900, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'Card and Funds from Venmo',
    })

    const people = await paymentPeople(probe.ctx.db)
    expect(people).toMatchObject({ names: [], loneNames: [], loneAnyCase: [], noteNames: [] })
    expect(people.rows.size).toBe(3)
    expect((await probe.notes()).sort()).toEqual(['Card and Funds from Venmo'])
  })
})
