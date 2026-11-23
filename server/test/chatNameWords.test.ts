// What Chat sends of the owner's notes (never) and of labels that hold a
// name that is also an everyday word ("Max", "Grace"), or a word of a shop's
// name ("Joe" of Trader Joe's, "Ruby" of Ruby Tuesday), and of ids beside an
// account mask. Every name is made up.

import { describe, expect, it } from 'vitest'
import { runAction } from '../src/actions/action.js'
import { listTransactionsAction } from '../src/actions/transactions.js'
import { chatToolText } from '../src/chat/toolOutput.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { knownShops } from '../src/domain/knownShops.js'
import { GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

/** Runs some SQL on the probe's database. */
const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

describe("the owner's note on a transaction", () => {
  it('is never sent, labelled row or shown, nor found by a search', async () => {
    const shop = (merchantName: string, detailed: string, note: string) =>
      pay(merchantName.toUpperCase(), 2_000, { merchantName, detailed, note })
    await shop('Costco', GROCERIES, 'dinner with Jack')
    await shop('Amazon', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'Costco run for the week')
    await pay('Zelle payment to JANE PRYCEWOOD', 2_000, { note: 'concert tickets' })

    const sent = await probe.transactions()
    expect(sent).toHaveLength(3)
    expect(sent.filter((tx) => 'note' in tx)).toEqual([])
    const text = await probe.everything()
    expect(['dinner', 'jack', 'concert', 'week'].filter((word) => text.includes(word))).toEqual([])

    const total = (search: string) =>
      probe.sent('list_transactions', { search }).then((out) => JSON.parse(out).total as number)
    for (const search of ['jack', 'dinner', 'concert', 'week']) {
      expect([search, await total(search)]).toEqual([search, 0])
    }
    expect(await total('costco')).toBe(1)
    // An assistant over MCP reads notes, so its search still matches them.
    const mcp = await runAction({ ...probe.ctx, agent: true }, listTransactionsAction, {
      search: 'jack',
    })
    expect(mcp.total).toBe(1)
  }, 30_000)
})

describe("the owner's labels", () => {
  it('hide a name that is also a word, but keep everyday words and shops', async () => {
    await pay("TRADER JOE'S #552", 2_000, { merchantName: "Trader Joe's", detailed: GROCERIES })
    await pay('KING SOOPERS #12', 2_000, { merchantName: 'King Soopers', detailed: GROCERIES })
    await sql(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Grace''s college fund', 5000), ('Lily braces', 5000), ('Hope chest', 5000),
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
      'Hope chest',
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
