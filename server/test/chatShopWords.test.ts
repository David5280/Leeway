// What Chat sends of the owner's labels beside the shops they buy from: a
// word of a label that starts a shop's name ("Ruby's Savings" beside Ruby
// Tuesday), or is one of its words ("Michael's college fund" beside Michael
// Kors), is hidden, while the shops themselves, and a label's surnames and
// everyday words, show as written. Every person is made up.

import { describe, expect, it } from 'vitest'
import { GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

/** Runs some SQL on the probe's database. */
const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

const RESTAURANT = 'FOOD_AND_DRINK_RESTAURANT'
const CLOTHES = 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES'

// Shops the owner buys from, each with Plaid's merchant and code: the ones
// a label's word starts or holds, and well-known ones that must show by name.
const SHOPS: [merchant: string, code: string][] = [
  ['Ruby Tuesday', RESTAURANT],
  ['Jack in the Box', 'FOOD_AND_DRINK_FAST_FOOD'],
  ['Ross', CLOTHES],
  ['Max Muscle', 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'],
  ['King Soopers', GROCERIES],
  ['Michael Kors', CLOTHES],
  ['Kate Spade', CLOTHES],
  ["Dave & Buster's", 'ENTERTAINMENT_OTHER_ENTERTAINMENT'],
  ["Ruth's Chris", RESTAURANT],
  ['Tim Hortons', 'FOOD_AND_DRINK_COFFEE'],
  ['Costco', GROCERIES],
  ['Amazon', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'],
  ["Trader Joe's", GROCERIES],
  ["Ben & Jerry's", 'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK'],
  ['Netflix', 'ENTERTAINMENT_TV_AND_MOVIES'],
  ['Whole Foods', GROCERIES],
  ['Chipotle', 'FOOD_AND_DRINK_FAST_FOOD'],
  ["Wendy's", 'FOOD_AND_DRINK_FAST_FOOD'],
  ['Target', 'GENERAL_MERCHANDISE_SUPERSTORES'],
  ['Spotify', 'ENTERTAINMENT_MUSIC'],
  ['Shell', 'TRANSPORTATION_GAS'],
  ["Dick's", 'GENERAL_MERCHANDISE_SPORTING_GOODS'],
  ['Panera Bread', RESTAURANT],
  ["McDonald's", 'FOOD_AND_DRINK_FAST_FOOD'],
  ['Burger King', 'FOOD_AND_DRINK_FAST_FOOD'],
]

/** Adds a category of each name. */
async function categories(names: string[]): Promise<void> {
  for (const [at, name] of names.entries()) {
    await sql(
      `INSERT INTO categories (name, color, kind, position) VALUES ($1, '#000000', 'expense', $2)`,
      [name, 90 + at],
    )
  }
}

/** Adds a goal of each name. */
async function goals(names: string[]): Promise<void> {
  for (const name of names) {
    await sql(`INSERT INTO goals (name, target_cents) VALUES ($1, 5000)`, [name])
  }
}

describe("a word of the owner's label beside a shop's name", () => {
  it("is hidden though it starts or is a word of a shop's name", async () => {
    // Plaid vouches for the chains whose names read like a person's.
    const vouched = new Set(['Max Muscle', 'Michael Kors', 'Kate Spade', 'Tim Hortons'])
    for (const [merchantName, detailed] of SHOPS) {
      const merchantEntityId = vouched.has(merchantName) ? `ent_fake_${merchantName}` : undefined
      await pay(merchantName.toUpperCase(), 2_000, { merchantName, detailed, merchantEntityId })
    }
    await sql(`UPDATE accounts SET display_name = 'Ruby''s Savings' WHERE id = $1`, [
      probe.accountId,
    ])
    await goals(["Ruby's braces", "Jack's tuition", "Max's car", "Michael's college fund"])
    await goals(['Kate braces', "Dave's tuition", 'Chris car'])
    await categories(['Ross allowance', 'Gifts for King', 'Tim allowance'])

    const labels = (await probe.sent('list_goals')) + (await probe.sent('list_categories'))
    const accounts = await probe.sent('summarize_accounts')
    const sent = labels + accounts
    const expected = [
      "someone's Savings",
      "someone's braces",
      "someone's tuition",
      "someone's car",
      "someone's college fund",
      'someone braces',
      'someone car',
      'someone allowance',
      'Gifts for someone',
    ]
    expect(expected.filter((label) => !sent.includes(label))).toEqual([])
    expect(labels).not.toMatch(/ruby|jack|max|michael|kate|dave|chris|ross|king|tim\b/i)
    // Leeway's own words about the account read its nickname without the name too.
    expect(accounts).toContain("available in someone's Savings")

    // Every shop still shows by its whole name.
    const totals = await probe.sent('top_merchants', { limit: 50 })
    const merchants = (JSON.parse(totals) as { merchant: string }[]).map((total) => total.merchant)
    const missing = SHOPS.map(([merchant]) => merchant).filter((shop) => !merchants.includes(shop))
    expect(missing).toEqual([])
  }, 30_000)

  it('stays when it is a surname or a word labels are named with', async () => {
    await pay('PRICE CHOPPER', 2_000, { merchantName: 'Price Chopper', detailed: GROCERIES })
    const labels = ['Black Friday', 'Green Energy', 'Love Gifts', 'Price Club', 'Gray Water']
    await categories([...labels, 'Rose Garden', 'Will & Trust', 'Lily braces', 'For Rose'])
    await goals(['Hunter Education', 'Holly Tree Service', 'Summer Vacation', 'Hope chest'])

    const sent = (await probe.sent('list_categories')) + (await probe.sent('list_goals'))
    const kept = [...labels, 'Rose Garden', 'Will & Trust', 'Hunter Education', 'Hope chest']
    const more = ['Holly Tree Service', 'Summer Vacation', 'someone braces', 'For someone']
    expect([...kept, ...more].filter((label) => !sent.includes(`"${label}"`))).toEqual([])
  })
})
