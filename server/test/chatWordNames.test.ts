// "Bill", "June" and "April" in the owner's labels: each is someone unless a
// small, explicit everyday sense vouches for it where it stands
// (chat/wordNames.ts), and every mark parts a label's words. Read through
// every step Chat takes, and end to end through the tools that list labels.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { pairs, shown } from './labelsShown.js'
import { useChatProbe } from './chatProbe.js'

/** The labels of a list that a tool's output shows as written, which should be none. */
const leaked = (labels: readonly string[]) =>
  pairs(labels).filter(([, reads]) => /\b(?:bill|june|april|mary|kate)\b/i.test(reads))

/** The labels of a list that a tool's output does not show as written, which should be none. */
const changed = (labels: readonly string[]) =>
  pairs(labels).filter(([label, reads]) => label !== reads)

describe('a word name with no everyday sense where it stands', () => {
  it('is someone after kin', () => {
    const kin = ['Brother Bill', 'Sister June', 'Son Bill', 'Daughter April', 'Wife June']
    expect(leaked([...kin, 'Husband Bill', 'Friend June', 'Loan to Brother Bill'])).toEqual([])
    expect(pairs(['Brother Bill', 'Loan to Brother Bill'])).toEqual([
      ['Brother Bill', 'Brother someone'],
      ['Loan to Brother Bill', 'Loan to Brother someone'],
    ])
  })

  it('is someone beside "&" or "and"', () => {
    const labels = ['Mom & Bill', 'Mom and June', 'Wedding - June & Bill', 'Bill & June']
    expect(leaked([...labels, 'BILL & JUNE'])).toEqual([])
    expect(pairs(['Bill & June', 'BILL & JUNE'])).toEqual([
      ['Bill & June', 'someone & someone'],
      ['BILL & JUNE', 'someone & someone'],
    ])
  })

  it('is someone after a verb or a role', () => {
    const labels = ['Pay back Bill', 'Owe June', 'Paid June', 'Gift Bill', 'Tutor Bill']
    expect(leaked([...labels, 'Nanny June', 'Landlord Bill'])).toEqual([])
    expect(shown(['Pay back Bill', 'Nanny June'])).toEqual(['Pay back someone', 'Nanny someone'])
  })

  it('is someone after any mark', () => {
    // An en dash (U+2013), an em dash (U+2014) and a middle dot (U+00B7).
    const labels = ['Braces \u2013 Bill', 'Braces \u2014 Bill', 'Braces + Bill', 'Braces . Bill']
    expect(leaked([...labels, 'Braces \u00b7 Bill', 'Braces_Bill'])).toEqual([])
    expect(shown(['Braces \u2014 Bill', 'Braces_Bill'])).toEqual([
      'Braces \u2014 someone',
      'Braces_someone',
    ])
  })

  it('is someone joined to an app, and a hyphenated name is hidden whole', () => {
    expect(pairs(['Venmo-June', 'VENMO-JUNE', 'VENMO PAYMENT JUNE'])).toEqual([
      ['Venmo-June', 'Venmo-someone'],
      ['VENMO-JUNE', 'Venmo-someone'],
      ['VENMO PAYMENT JUNE', 'VENMO PAYMENT someone'],
    ])
    // A non-breaking hyphen (U+2011) parts a name as a hyphen does.
    const nonBreaking = 'Mary\u2011Kate allowance'
    expect(shown([nonBreaking])).toEqual(['someone\u2011someone allowance'])
    expect(shown(['Mary-Kate allowance'])).toEqual(['someone-someone allowance'])
  })

  it('is someone where hiding a word costs less than showing a name', () => {
    const labels = ['Water bill - June', 'Utilities: Bill', 'Taxes - April', 'June rent']
    expect(shown([...labels, 'Rent for June', 'Venmo June 15', 'Electric Bill Ostrowski'])).toEqual(
      [
        'Water bill - someone',
        'Utilities: someone',
        'Taxes - someone',
        'someone rent',
        'Rent for someone',
        'Venmo someone 15',
        'Electric someone someone',
      ],
    )
  })
})

describe('a word name with its everyday sense vouched for', () => {
  it('stays as the whole label, after what is billed or in a set phrase', () => {
    const bills = ['Bill', 'Bills', 'Electric bill', 'Water bill', 'Phone bill', 'ELECTRIC BILL']
    expect(changed([...bills, 'Bill pay', 'Bill payments', 'Bill splitting'])).toEqual([])
  })

  it('stays as a month after a date word or beside a number', () => {
    const months = ['June', 'April', 'Due in June', 'Due June', 'June 15', 'April 2027']
    expect(changed([...months, 'Paid by April', '15th April', 'May rent'])).toEqual([])
  })

  it('leaves ordinary words, a surname read as the word and a shop', () => {
    const words = ['Brown rice', 'Young Living', 'Rice', 'Halloween costumes', 'Coats']
    expect(changed([...words, 'School lunch', 'Books', 'Teacher gift', 'Friends'])).toEqual([])
    expect(changed(['Wegmans groceries', 'Target runs'])).toEqual([])
  })
})

describe('the tools that list labels', () => {
  const probe = useChatProbe()
  const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

  it('hide a word name with no everyday sense, and keep one with it', async () => {
    const inserted = await sql(
      `INSERT INTO categories (name, color, kind, position) VALUES
         ('Venmo-June', '#000000', 'expense', 90), ('Braces_Bill', '#000000', 'expense', 91),
         ('Electric bill', '#000000', 'expense', 92), ('Brown rice', '#000000', 'expense', 93)
       RETURNING id`,
    )
    const category = (inserted.rows[0] as { id: string }).id
    await sql(
      `INSERT INTO rules (field, match_type, pattern, category_id, position) VALUES
         ('description', 'contains', 'VENMO PAYMENT JUNE', $1, 1),
         ('description', 'contains', 'BILL & JUNE', $1, 2)`,
      [category],
    )
    await sql(
      `INSERT INTO goals (name, target_cents) VALUES
         ('Loan to Brother Bill', 5000), ('Due in June', 5000)`,
    )

    const categories = await probe.sent('list_categories')
    const goals = await probe.sent('list_goals')
    const rules = await probe.sent('list_rules')
    expect(categories).toContain('"Venmo-someone"')
    expect(categories).toContain('"Braces_someone"')
    expect(categories).toContain('"Electric bill"')
    expect(categories).toContain('"Brown rice"')
    expect(goals).toContain('"Loan to Brother someone"')
    expect(goals).toContain('"Due in June"')
    expect(rules).not.toMatch(/june|bill/i)
    expect(`${categories} ${goals}`).not.toMatch(/Venmo-June|Braces_Bill|Brother Bill/i)
  }, 30_000)

  it('still show the shops the owner buys from, one named like a person included', async () => {
    const shop = (merchantName: string, detailed: string) =>
      probe.pay(merchantName.toUpperCase(), 2_000, {
        merchantName,
        detailed,
        merchantEntityId: `ent_fake_${merchantName.toLowerCase()}`,
      })
    await shop('Ross', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES')
    await shop('CVS', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS')
    await shop('Walgreens', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS')
    await shop('BetterHelp', 'MEDICAL_PRIMARY_CARE')
    const shown = (await probe.transactions()).map((tx) => tx.displayName).sort()
    expect(shown).toEqual(['BetterHelp', 'CVS', 'Ross', 'Walgreens'])
  }, 30_000)
})
