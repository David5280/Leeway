// The allowlist (modelLabels.ts) read from real rows through every tool: a
// row shows its name to a model only when it is surely a purchase from a
// business, every other row is labelled, and the names those rows hold are
// hidden wherever else they are written. Every name is made up.

import { describe, expect, it } from 'vitest'
import { runAction } from '../src/actions/action.js'
import { topMerchantsAction } from '../src/actions/insights.js'
import { listTransactionsAction } from '../src/actions/transactions.js'
import { HIDDEN_SEARCH_MESSAGE } from '../src/chat/searchGuard.js'
import { ACCOUNT_TRANSFER, GROCERIES, useChatProbe } from './chatProbe.js'

const SERVICES = 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'
const MERCHANDISE = 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'
const LOAN = 'LOAN_PAYMENTS_OTHER_PAYMENT'
const CARD = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
const probe = useChatProbe()
const { pay } = probe

/** Each transaction as the model is shown it, sorted. */
async function shown(): Promise<string[]> {
  return (await probe.transactions()).map((tx) => tx.displayName).sort()
}

/** Adds a row in each of four months up to this one. */
async function monthly(name: string, cents: number, fields = {}): Promise<void> {
  for (const month of ['08', '09', '10', '11']) {
    await pay(name, cents, { ...fields, date: `2026-${month}-15` })
  }
}

// The surnames and given names the rows below hold.
const HIDDEN = [
  'brightwater',
  'hawthorne',
  'marguerite',
  'blackwood',
  'ignatius',
  'abercrombie',
  'rosalind',
  'thornbury',
  'fennimore',
  'bexley',
  'larkspur',
  'odalys',
  'carrow',
  'ysolde',
  'prycewood',
  'mossgiel',
  'quillfeather',
  'wexford',
  'halvorsen',
  'ingrid',
  'penhallow',
  'tamsin',
]

describe('a row that is surely no purchase from a business', () => {
  it('is labelled, and no tool shows a name it holds or an account number', async () => {
    await monthly('Zelle payment to Aurelia Brightwater JPM99A1B2C3', 120_000, {
      detailed: ACCOUNT_TRANSFER,
    })
    // How banks write paying a person: bill pay, a check, ACH, a wire, a deposit.
    await monthly('BILL PAY MARGUERITE HAWTHORNE ON-LINE', 30_000, { detailed: SERVICES })
    await pay('ONLINE BILL PAYMENT TO MARGUERITE HAWTHORNE CONF 55512', 30_000, {
      detailed: 'RENT_AND_UTILITIES_RENT',
    })
    await pay('CHECK 1043 IGNATIUS BLACKWOOD', 15_000, { detailed: SERVICES })
    await monthly('ACH DEBIT ROSALIND ABERCROMBIE PPD', 20_000, { detailed: LOAN })
    await pay('ONLINE PMT JANE THORNBURY', 20_000, { detailed: LOAN })
    await pay('DEPOSIT FROM BEXLEY FENNIMORE', -20_000, { detailed: 'INCOME_OTHER_INCOME' })
    // A person named as the merchant, under a code a business could have too.
    await monthly('ODALYS LARKSPUR', 18_000, {
      merchantName: 'Odalys Larkspur',
      detailed: SERVICES,
    })
    await pay('DR. ODALYS LARKSPUR LCSW', 15_000, {
      merchantName: 'Odalys Larkspur',
      detailed: 'MEDICAL_OTHER_MEDICAL',
    })
    await pay('YSOLDE CARROW', 20_000, {
      merchantName: 'Ysolde Carrow',
      detailed: 'PERSONAL_CARE_OTHER_PERSONAL_CARE',
    })
    // Rows a statement file brought in, with no code.
    await pay('Payment Jane Mossgiel', 2_100, { imported: true })
    await pay('JANE QUILLFEATHER', 2_200, { imported: true })
    await pay('Transfer to Jane Wexford ACCT 123456789', 2_300, { imported: true })
    // A surname first after a slash, and a name in look-alike and invisible characters.
    await pay('ZELLE TO HALVORSEN/INGRID', 3_000, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle to Jаne Prycеwood', 3_000, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle to Tam­sin Pen​hallow', 3_000, { detailed: ACCOUNT_TRANSFER })
    // PayPal to a person under general goods, beside a purchase at a shop it names.
    await pay('PAYPAL *TAMSINPENHALLOW', 4_500, { detailed: MERCHANDISE })
    await pay('PAYPAL *SPOTIFY', 1_199, {
      merchantName: 'Spotify',
      detailed: 'ENTERTAINMENT_MUSIC',
    })
    await pay('VENMO TO VENMO CREDIT CARD', 30_000, { detailed: CARD })
    await monthly('HOOKED ON COLFAX DENVER CO', 900, {
      merchantName: 'Hooked on Colfax',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })
    await pay('KING SOOPERS #12', 8_000, {
      merchantName: 'King Soopers',
      detailed: GROCERIES,
      note: 'dinner w/ ingrid and aurelia brightwater, Halvorsen/Ingrid, Prycewood. acct 4417',
    })
    await pay('PAYROLL ACME CORP', -350_000, { detailed: 'INCOME_WAGES' })
    // What the owner wrote: categories, goals, bills and a rule naming the same people.
    await probe.ctx.db.query(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Gifts for ingrid halvorsen', '#000000', 'expense', 90),
         ('Larkspur sessions', '#000000', 'expense', 91)`,
    )
    await probe.ctx.db.query(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Prycewood/Halvorsen trip', 90000), ('Tamsin', 5000), ('PS5 fund', 70000)`,
    )
    await probe.ctx.db.query(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern) VALUES
         ('Brightwater', 120000, 'month', '2026-12-15', 'brightwater'),
         ('Rent', 120000, 'month', '2026-12-15', 'zelle payment to aurelia'),
         ('Abercrombie loan', 20000, 'month', '2026-12-15', 'ROSALIND ABERCROMBIE'),
         ('Cleaner', 18000, 'month', '2026-12-15', 'ODALYS LARKSPUR'),
         ('Netflix', 1549, 'month', '2026-12-15', 'netflix')`,
    )

    const text = await probe.everything()
    expect(HIDDEN.filter((name) => text.includes(name))).toEqual([])
    for (const number of ['4417', '123456789', '55512', 'jpm99a1b2c3']) {
      expect([number, text.includes(number)]).toEqual([number, false])
    }
    expect([...new Set(await shown())]).toEqual([
      'Bill payment',
      'Card payment',
      'Deposit',
      'Hooked on Colfax',
      'King Soopers',
      'Loan payment',
      'Medical payment',
      'PayPal payment (sent)',
      'Payment sent',
      'Payroll Acme Corp',
      'Purchase or payment',
      'Rent payment',
      'Service payment',
      'Spotify',
      'Zelle payment (sent)',
    ])
    // A note naming people is left out whole: no word of it is surely no one's.
    expect(await probe.notes()).toEqual([])
    const goals = await probe.sent('list_goals')
    for (const goal of ['"someone/someone trip"', '"someone"', '"PS5 fund"']) {
      expect(goals).toContain(goal)
    }
    const { bills } = JSON.parse(await probe.sent('list_bills')) as { bills: { name: string }[] }
    expect(bills.map((bill) => bill.name).sort()).toEqual([
      'Cleaner',
      'Loan payment',
      'Netflix',
      'Rent',
      'Zelle payment (sent)',
    ])
    const totals = JSON.parse(await probe.sent('top_merchants', { limit: 50 })) as {
      merchant: string
    }[]
    expect(totals.map((total) => total.merchant)).toEqual(
      expect.arrayContaining(['Hooked on Colfax', 'King Soopers', 'Spotify']),
    )
  }, 30_000)

  it('stays as the owner sees it in the app', async () => {
    await pay('VENMO TO VENMO CREDIT CARD', 30_000, { detailed: CARD })
    const owners = await runAction(probe.ctx, listTransactionsAction, {})
    expect(owners.transactions.map((tx) => tx.displayName)).toEqual(['To Venmo Credit Card'])
    expect(await shown()).toEqual(['Card payment'])
  })
})

describe('a row whose name has no person in it', () => {
  it('shows a two-word merchant when Plaid vouched for the business', async () => {
    const coffee = { merchantName: 'Blue Bottle', detailed: 'FOOD_AND_DRINK_COFFEE' }
    await pay('SQ *BLUE BOTTLE', 600, coffee)
    expect(await shown()).toEqual(['Purchase or payment'])
    await pay('SQ *BLUE BOTTLE', 600, { ...coffee, merchantEntityId: 'ent_fake_coffee' })
    expect(await shown()).toEqual(['Blue Bottle', 'Purchase or payment'])
  })
})

describe('a search', () => {
  it('is refused for a hidden word only when it searches that word as a whole', async () => {
    await pay('Zelle payment to SAM QUORNBY', 2_000, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle payment to MAX DELACROIX', 2_000, { detailed: ACCOUNT_TRANSFER })
    await pay('SAMSUNG ELECTRONICS', 9_900, {
      merchantName: 'Samsung',
      detailed: 'GENERAL_MERCHANDISE_ELECTRONICS',
    })
    await pay('HBO MAX', 1_599, {
      merchantName: 'HBO Max',
      detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
    })

    for (const search of ['sam', 'quornby', 'max delacroix']) {
      const result = await probe.run('list_transactions', { search })
      expect([search, result.content]).toEqual([search, HIDDEN_SEARCH_MESSAGE])
    }
    for (const [search, found] of [
      ['samsung', 'Samsung'],
      ['hbo max', 'Hbo Max'],
    ]) {
      const { transactions } = JSON.parse(await probe.sent('list_transactions', { search })) as {
        transactions: { displayName: string }[]
      }
      expect([search, transactions.map((tx) => tx.displayName)]).toEqual([search, [found]])
    }
  })
})

describe('the same merchant as a labelled row', () => {
  it('is every row with its label, paged, never only those paid to one person', async () => {
    const first = await pay('Zelle payment to Aurelia Brightwater', 3_000, {
      detailed: ACCOUNT_TRANSFER,
      date: '2026-11-03',
    })
    await pay('Zelle payment to Cosimo Ravensdale', 4_000, {
      detailed: ACCOUNT_TRANSFER,
      date: '2026-11-04',
    })
    await pay('Zelle payment to Aurelia Brightwater', 5_000, {
      detailed: ACCOUNT_TRANSFER,
      date: '2026-11-05',
    })
    await pay('VENMO *AURELIA BRIGHTWATER', 6_000, { detailed: ACCOUNT_TRANSFER })
    await pay('KING SOOPERS', 900, { merchantName: 'King Soopers', detailed: GROCERIES })

    const same = async (input: Record<string, unknown>) =>
      JSON.parse(await probe.sent('list_transactions', { sameMerchantAs: first, ...input })) as {
        transactions: { amountCents: number; displayName: string }[]
        total: number
      }
    const all = await same({})
    expect(all.total).toBe(3)
    expect(all.transactions.map((tx) => tx.amountCents).sort()).toEqual([3_000, 4_000, 5_000])
    expect(new Set(all.transactions.map((tx) => tx.displayName))).toEqual(
      new Set(['Zelle payment (sent)']),
    )
    const page = await same({ limit: 1, offset: 1 })
    expect([page.total, page.transactions.length]).toEqual([3, 1])
    // Anything else in the input still holds, and so does a row shown by name.
    expect((await same({ limit: 'many', offset: -1.5 })).total).toBe(3)
    const king = (await probe.transactions()).find((tx) => tx.displayName === 'King Soopers')!
    const shop = JSON.parse(await probe.sent('list_transactions', { sameMerchantAs: king.id }))
    expect(shop.total).toBe(1)
  })
})

describe("a merchant's total", () => {
  it('is one for the owner, and shown by its label when any row in it is labelled', async () => {
    await pay('CHECK 1043', 15_000, { detailed: SERVICES })
    await pay('CHECK 1044', 15_000)
    await pay('VENMO', 5_000, { merchantName: 'Venmo', detailed: ACCOUNT_TRANSFER })
    await pay('VENMO', -2_000, { merchantName: 'Venmo', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' })
    await pay('KING SOOPERS', 900, { merchantName: 'King Soopers', detailed: GROCERIES })

    const owners = await runAction(probe.ctx, topMerchantsAction, {})
    expect(owners.map(({ merchant, spentCents, count }) => [merchant, spentCents, count])).toEqual([
      ['Check', 30_000, 2],
      // Money back from Venmo counts against it, as a refund does.
      ['Venmo', 3_000, 2],
      ['King Soopers', 900, 1],
    ])
    // Each total mixes labels (a service and no code; Venmo out and in), so a model
    // sees one "Purchase or payment", added up as one as it would be anywhere.
    expect(JSON.parse(await probe.sent('top_merchants'))).toEqual([
      { merchant: 'Purchase or payment', spentCents: 33_000, count: 4 },
      { merchant: 'King Soopers', spentCents: 900, count: 1 },
    ])
  })
})
