// What Chat sends of rows Plaid coded as a business but that may still be a
// person's, of names only the owner wrote (notes, labels, accounts), and of
// shops a search or a statement file names. Every name is made up.

import { describe, expect, it } from 'vitest'
import { HIDDEN_SEARCH_MESSAGE } from '../src/chat/searchGuard.js'
import { namesInLabels, noteMaySend } from '../src/domain/chat/ownerText.js'
import { paymentPeople } from '../src/domain/chat/people.js'
import { ACCOUNT_TRANSFER, GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

/** Runs some SQL on the probe's database. */
const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

describe('a row with a code Plaid gives businesses', () => {
  it("is labelled when it could be a person's, whatever every tool sends", async () => {
    const medical = 'MEDICAL_PRIMARY_CARE'
    await pay('SARAH BETH HOLLOWAY', 9_000, { detailed: 'MEDICAL_OTHER_MEDICAL' })
    await pay('CORWIN ASHBY DC', 8_000, { detailed: medical })
    await pay('MARA LINDQVIST NP', 7_000, { detailed: medical })
    await pay('JUAN CARLOS ECHEVERRIA', 30_000, {
      merchantName: 'Juan Carlos Echeverria',
      detailed: 'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
    })
    const restaurant = { detailed: 'FOOD_AND_DRINK_RESTAURANT' }
    await pay('SQ *J PEMBERTON', 1_500, restaurant)
    await pay('SQ *MAEVE ANNE CALLOWAY', 1_600, restaurant)
    await pay('PAYPAL *MARIA JOSE LOPEZ', 1_700, {
      merchantName: 'Maria Jose Lopez',
      detailed: 'FOOD_AND_DRINK_FAST_FOOD',
    })
    await pay('DIRECT DEP JOHN Q PUBLIC HOUSEHOLD PAYROLL', -90_000, { detailed: 'INCOME_WAGES' })
    // Real shops beside them still show by name.
    const shops: [string, string, string][] = [
      ['COSTCO WHSE #0482', 'Costco', GROCERIES],
      ['AMAZON MKTPL*AB12CD', 'Amazon', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'],
      ["TRADER JOE'S #552", "Trader Joe's", GROCERIES],
      ["BEN & JERRY'S", "Ben & Jerry's", 'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK'],
      ['NETFLIX.COM', 'Netflix', 'ENTERTAINMENT_TV_AND_MOVIES'],
    ]
    for (const [line, merchantName, detailed] of shops)
      await pay(line, 2_000, { merchantName, detailed })
    await pay('SQ *BLUE BOTTLE', 600, {
      merchantName: 'Blue Bottle',
      detailed: 'FOOD_AND_DRINK_COFFEE',
      merchantEntityId: 'ent_fake_coffee',
    })

    const text = await probe.everything()
    const names = 'holloway corwin ashby lindqvist echeverria pemberton maeve calloway lopez public'
    expect(names.split(' ').filter((name) => text.includes(name))).toEqual([])
    const totals = JSON.parse(await probe.sent('top_merchants', { limit: 50 })) as {
      merchant: string
    }[]
    expect(totals.map((total) => total.merchant)).toEqual(
      expect.arrayContaining(['Costco', 'Amazon', "Trader Joe's", "Ben & Jerry's", 'Netflix']),
    )
    expect(totals.map((total) => total.merchant)).toContain('Blue Bottle')
  }, 30_000)
})

describe('a name written with an apostrophe or a hyphen', () => {
  it('is hidden however the owner wrote it, and no search finds it', async () => {
    await pay('VENMO TO SIOBHAN O’BRIEN', 2_000)
    await pay('Zelle to José Núñez-García', 2_000, { detailed: ACCOUNT_TRANSFER })
    await pay('Zelle to Mary-Kate Abernethy', 2_000, { detailed: ACCOUNT_TRANSFER })
    await sql(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Siobhan O''Brien''s gift', 5000), ('NUNEZ GARCIA JOSE fund', 5000),
         ('Mary Kate, MaryKate', 5000)`,
    )

    const goals = (await probe.sent('list_goals')).toLowerCase()
    expect(goals).not.toMatch(/siobhan|brien|nunez|garcia|jose|mary|kate|abernethy/)
    for (const search of ['marykate', 'garcia', "o'brien", 'nunez garcia']) {
      const result = await probe.run('list_transactions', { search })
      expect([search, result.content]).toEqual([search, HIDDEN_SEARCH_MESSAGE])
    }
  })
})

describe('what only the owner wrote', () => {
  it('names no one and shows no account mask, but keeps everyday words', async () => {
    await pay('AMAZON MKTPL*AB12CD', 4_000, {
      merchantName: 'Amazon',
      detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
      note: 'gift for Ignatius Thorne',
    })
    await pay('COSTCO WHSE #0482', 9_000, {
      merchantName: 'Costco',
      detailed: GROCERIES,
      note: 'Costco run for the week, acct 4417',
    })
    const inserted = await sql(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Ignatius allowance', '#000000', 'expense', 90),
         ('Dining out', '#000000', 'expense', 91) RETURNING id`,
    )
    const category = (inserted.rows[0] as { id: string }).id
    await sql(
      `INSERT INTO rules (field, match_type, pattern, category_id, position)
       VALUES ('description', 'contains', 'ignatius', $1, 1)`,
      [category],
    )
    await sql(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Pay off card 4417', 90000), ('Emergency fund', 500000)`,
    )
    await sql(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date)
       VALUES ('Piano with Ottilie Fairbanks', 12000, 'month', '2026-12-01')`,
    )
    await sql(`UPDATE accounts SET display_name = 'Bettina''s Savings' WHERE id = $1`, [
      probe.accountId,
    ])
    await sql(
      `INSERT INTO accounts (name, type, kind, balance_cents) VALUES
         ('Loan from Ferdinand Ostrowski', 'loan', 'loan', 500000),
         ('Ferdinand pension', 'investment', 'pension', 0)`,
    )

    const text = await probe.everything()
    const names = 'ignatius thorne ottilie fairbanks bettina ferdinand ostrowski 4417'
    expect(names.split(' ').filter((name) => text.includes(name))).toEqual([])
    expect(await probe.notes()).toEqual(['Costco run for the week, acct ••••'])
    const categories = await probe.sent('list_categories')
    expect(categories).toContain('"someone allowance"')
    expect(categories).toContain('"Dining out"')
    expect(await probe.sent('list_goals')).toContain('"Emergency fund"')
    expect(await probe.sent('list_bills')).toContain('"Piano with someone someone"')
  }, 30_000)
})

describe('a shop the owner buys from', () => {
  it('may be searched though one of its rows is shown by a label', async () => {
    const coffee = { merchantName: 'Blue Bottle', detailed: 'FOOD_AND_DRINK_COFFEE' }
    await pay('SQ *BLUE BOTTLE', 600, { ...coffee, merchantEntityId: 'ent_fake_coffee' })
    await pay('BLUE BOTTLE COFFEE', 700, coffee)

    for (const search of ['Blue Bottle', 'blue bot']) {
      const result = await probe.run('list_transactions', { search })
      expect(result.content).not.toBe(HIDDEN_SEARCH_MESSAGE)
      expect((JSON.parse(result.content) as { total: number }).total).toBe(2)
    }
    expect((await probe.run('preview_rule', { pattern: 'blue bottle' })).content).not.toBe(
      HIDDEN_SEARCH_MESSAGE,
    )
  })

  it('shows by name on a row a statement file brought in', async () => {
    await pay('COSTCO WHSE #1180', 27_800, { merchantName: 'Costco', detailed: GROCERIES })
    await pay('COSTCO WHSE #0482', 21_000, { imported: true })
    await pay('JANE QUILLFEATHER', 2_200, { imported: true })

    const shown = (await probe.transactions()).map((tx) => tx.displayName).sort()
    expect(shown).toEqual(['Costco', 'Costco Warehouse', 'Purchase or payment'])
  })
})

describe("the owner's own words", () => {
  /** Words a shown row holds, as a test stands them in. */
  const shown = (word: string) => ['amzn', 'mktp', 'marigold'].includes(word)

  it('hide what could be a name in a label, but no everyday, brand or shown word', () => {
    const labels = [
      'Ignatius allowance',
      'Bettina’s Savings',
      "Lowe's run",
      'Netflix',
      'TV fund',
      'Al',
      'Colorado PERA',
      'amzn mktp',
      'Marigold-',
      'Mary-Kate gifts',
    ]
    expect(namesInLabels(labels, shown)).toEqual(['Ignatius', 'Bettina', 'Mary-Kate'])
  })

  it("send a note only when every word of it is surely no one's", () => {
    for (const note of ['Costco run for the week', 'Gift for mom', 'Marigold, order #1234', '']) {
      expect([note, noteMaySend(note, shown)]).toEqual([note, true])
    }
    for (const note of ['gift for Ignatius Thorne', 'Lunch w/ Jo', 'Rent to John']) {
      expect([note, noteMaySend(note, shown)]).toEqual([note, false])
    }
  })
})

describe('a bank word or a business word on a labelled row', () => {
  it('is never hidden, so a word like "check" or a jeweler stays', async () => {
    // A check with no code is labelled, and one imported shows as "Check": neither names anyone.
    await pay('CHECK 1235', 15_000)
    await pay('CHECK 1236', 15_000, { imported: true })
    await pay('VENMO TO SIOBHAN O’BRIEN', 2_000)
    await pay('KAY JEWELERS', 30_000, {
      merchantName: 'Kay Jewelers',
      detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
    })
    await pay('Farmers market', 2_500, { imported: true })
    await sql(`INSERT INTO goals (name, target_cents) VALUES ('Check the bank', 5000)`)

    const people = await paymentPeople(probe.ctx.db)
    expect(people.phrases.map(([phrase]) => phrase)).not.toContain('Check')
    expect(people.hiddenWords).not.toContain('o')
    expect(people.hiddenWords).not.toContain('kay')
    expect(await probe.sent('list_goals')).toContain('"Check the bank"')
    expect((await probe.run('list_transactions', { search: 'o reilly' })).content).not.toBe(
      HIDDEN_SEARCH_MESSAGE,
    )
    const shown = (await probe.transactions()).map((tx) => tx.displayName)
    expect(shown).toEqual(expect.arrayContaining(['Kay Jewelers', 'Farmers market']))
  })
})
