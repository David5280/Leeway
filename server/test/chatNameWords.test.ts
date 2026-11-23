// What Chat sends of the owner's notes and labels that hold a name that is
// also an everyday word ("Max", "Grace", "Hope"), or the given name a shop
// is named for ("Joe" of Trader Joe's), and of ids beside an account mask.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { chatToolText } from '../src/chat/toolOutput.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { knownShops } from '../src/domain/knownShops.js'
import { GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

/** Runs some SQL on the probe's database. */
const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

describe('a note on a row shown by name', () => {
  it("is left out when it could name someone, though a shop's word is in it", async () => {
    const shop = (merchantName: string, detailed: string, note: string) =>
      pay(merchantName.toUpperCase(), 2_000, { merchantName, detailed, note })
    await shop('Amazon', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'gift for Max')
    await shop("Trader Joe's", GROCERIES, 'birthday gift for Joe')
    await shop("Wendy's", 'FOOD_AND_DRINK_FAST_FOOD', 'dinner with Wendy')
    await shop("Sam's Club", 'GENERAL_MERCHANDISE_SUPERSTORES', "Sam's birthday")
    await shop('Ross', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', 'gift for Ross')
    await shop('HBO Max', 'ENTERTAINMENT_TV_AND_MOVIES', 'Will paid me back')
    // The shop's own whole name, and everyday words, still go.
    await shop("Trader Joe's", GROCERIES, "Trader Joe's run")
    await shop("Sam's Club", 'GENERAL_MERCHANDISE_SUPERSTORES', "Sam's Club run for the party")
    await shop('Costco', GROCERIES, 'Costco run for the week')

    expect((await probe.notes()).sort()).toEqual([
      'Costco run for the week',
      "Sam's Club run for the party",
      "Trader Joe's run",
    ])
  })
})

describe("the owner's labels", () => {
  it('hide a name that is also a word, but keep everyday words and shops', async () => {
    await pay("TRADER JOE'S #552", 2_000, { merchantName: "Trader Joe's", detailed: GROCERIES })
    await pay('KING SOOPERS #12', 2_000, { merchantName: 'King Soopers', detailed: GROCERIES })
    await sql(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Grace''s college fund', 5000), ('Lily braces', 5000), ('Hope support', 5000),
         ('Car payoff', 5000), ('Italy trip', 5000), ('Joe''s birthday', 5000)`,
    )
    await sql(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Max allowance', '#000000', 'expense', 90), ('Dog walker', '#000000', 'expense', 91),
         ('Cleaning lady', '#000000', 'expense', 92), ('Giving', '#000000', 'expense', 93),
         ('Trader Joe''s', '#000000', 'expense', 94), ('King Soopers', '#000000', 'expense', 95)`,
    )
    await sql(`UPDATE accounts SET display_name = 'Ruby''s Savings' WHERE id = $1`, [
      probe.accountId,
    ])

    const goals = await probe.sent('list_goals')
    for (const goal of [
      "someone's college fund",
      'someone braces',
      'someone support',
      'Car payoff',
      'Italy trip',
      "someone's birthday",
    ]) {
      expect([goal, goals.includes(`"${goal}"`)]).toEqual([goal, true])
    }
    const categories = await probe.sent('list_categories')
    for (const category of [
      'someone allowance',
      'Dog walker',
      'Cleaning lady',
      'Giving',
      "Trader Joe's",
      'King Soopers',
    ]) {
      expect([category, categories.includes(`"${category}"`)]).toEqual([category, true])
    }
    expect(await probe.sent('summarize_accounts')).toContain("someone's Savings")
    expect(await probe.merchants()).toEqual(
      expect.arrayContaining(["Trader Joe's", 'King Soopers']),
    )
    const text = await probe.everything()
    expect(['grace', 'lily', 'ruby'].filter((name) => text.includes(name))).toEqual([])
  }, 30_000)
})

describe('a tool result', () => {
  it("keeps an id whole beside an account mask, and a shop's name beside a hidden word", () => {
    const id = '9f1c4417-ab3e-4c2d-8e1f-0a1b2c3d4e5f'
    const people = {
      ...NO_PEOPLE,
      loneNames: ['Joe'],
      masks: ['4417'],
      shops: knownShops(["Trader Joe's"]),
    }
    const result = {
      goals: [{ id, name: "Joe's birthday, card 4417", accountId: id }],
      byId: { [id]: ["Trader Joe's", id] },
    }
    expect(JSON.parse(chatToolText(result, people))).toEqual({
      goals: [{ id, name: "someone's birthday, card ••••", accountId: id }],
      byId: { [id]: ["Trader Joe's", id] },
    })
  })
})
