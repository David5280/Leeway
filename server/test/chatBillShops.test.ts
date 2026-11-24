// "Bill" in the owner's labels beside the shops they buy from, end to end: a
// shop's word vouches for it only when that word is itself shown, so a
// person's name never leaks after a hidden word, a role or "for". Every
// person and practice is made up.

import { describe, expect, it } from 'vitest'
import { useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

/** Runs some SQL on the probe's database. */
const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

// Shops the owner buys from, with Plaid's merchant code, and whether Plaid
// vouches for the merchant (as it does for a chain named like a word).
const SHOPS: [merchant: string, code: string, vouched?: boolean][] = [
  ['Coach', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', true],
  ['Coach Outlet', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES'],
  ['Pemberton Plumbing', 'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE'],
  ['Doe Dental', 'MEDICAL_DENTAL_CARE'],
  ['Kaiser Permanente', 'MEDICAL_PRIMARY_CARE'],
  ['Tutor Doctor', 'GENERAL_SERVICES_EDUCATION'],
  ['Xcel Energy', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'],
  ['Verizon', 'RENT_AND_UTILITIES_TELEPHONE'],
  ['Target', 'GENERAL_MERCHANDISE_SUPERSTORES'],
  ['AT&T', 'RENT_AND_UTILITIES_TELEPHONE'],
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

describe('"Bill" after a shop\'s word, end to end', () => {
  it('is hidden after a hidden word, a role or "for", and stays after a shown shop', async () => {
    for (const [merchantName, detailed, vouched] of SHOPS) {
      const merchantEntityId = vouched ? `ent_fake_${merchantName}` : undefined
      await pay(merchantName.toUpperCase(), 2_000, { merchantName, detailed, merchantEntityId })
    }
    await categories(['Coach Bill lessons', 'Coach Bill', 'Gift for Pemberton Bill'])
    await categories(['Pemberton Bill', 'Doe Bill', 'Mo&Jo bill'])
    await goals(['Kaiser Bill', 'Tutor Bill', 'Gift for Target Bill'])
    const kept = ['Xcel bill', 'Verizon bill', 'Target bill', 'AT&T bill', 'Xcel Energy bill']
    await categories([...kept, 'Bill-due', 'Electric-Bill'])
    await goals(['Phone-bill'])

    const labels = (await probe.sent('list_categories')) + (await probe.sent('list_goals'))
    // No "Bill" with a capital shows but one a hyphen joins to its word: each names a person.
    expect(labels).not.toMatch(/(?<!-)Bill\b(?!-)|Pemberton|Doe|Kaiser|Jo\b/)
    const hidden = ['"Coach someone lessons"', '"Coach someone"', '"Gift for someone someone"']
    const more = ['"someone someone"', '"Tutor someone"', '"Mo&someone someone"']
    expect([...hidden, ...more].filter((label) => !labels.includes(label))).toEqual([])
    const shown = [...kept, 'Bill-due', 'Electric-Bill', 'Phone-bill']
    expect(shown.filter((label) => !labels.includes(`"${label}"`))).toEqual([])
    // Nor does any other tool show a name from these labels.
    expect(await probe.everything()).not.toMatch(/coach bill|tutor bill|pemberton bill|doe bill/i)
  }, 30_000)
})
