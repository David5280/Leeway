import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import {
  categoryInputSchema,
  createCategory,
  listCategories,
  type Category,
} from '../src/domain/categories.js'
import { recategorize } from '../src/domain/categorize.js'
import { createOwner, markOnboarded } from '../src/domain/owner.js'
import { createRule, listRules } from '../src/domain/rules.js'
import { STARTER_RULES } from '../src/domain/starterRules.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'
import {
  FIRST_STARTER_CODES,
  STARTER_UPGRADE,
  successorOf,
  upgradeStarterSet,
} from '../src/domain/starterUpgrade.js'
import { setCategory } from '../src/domain/transactions.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** The first-set categories that were not spending. */
const FIRST_STARTER_KINDS: Record<string, Category['kind']> = {
  Income: 'income',
  Transfers: 'transfer',
}

/** An owner who finished setup. */
async function onboardedOwner(): Promise<void> {
  await createOwner(ctx.db, { email: 'me@example.com', password: 'correct horse battery' })
  await markOnboarded(ctx.db)
}

/**
 * The first starter set as setup created it, with the owner's own budgets.
 * `edit` changes a category's fields before it is saved, as if edited later.
 */
async function firstStarterSet(
  edit: Record<string, Partial<Category>> = {},
): Promise<Map<string, Category>> {
  for (const [name, codes] of Object.entries(FIRST_STARTER_CODES)) {
    const kind = FIRST_STARTER_KINDS[name] ?? 'expense'
    const budgetCents = kind === 'expense' ? 12300 : null
    await createCategory(
      ctx.db,
      categoryInputSchema.parse({
        name,
        kind,
        budgetCents,
        providerCategories: codes,
        ...edit[name],
      }),
    )
  }
  return byName()
}

async function byName(): Promise<Map<string, Category>> {
  return new Map((await listCategories(ctx.db)).map((c) => [c.name, c]))
}

/** Each transaction's description, category name and how it got there. */
async function filed(): Promise<Record<string, [string | null, string | null]>> {
  const { rows } = await ctx.db.query<{ name: string; category: string | null; source: string }>(
    `SELECT t.name, c.name AS category, t.category_source AS source FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.name`,
  )
  return Object.fromEntries(rows.map((r) => [r.name, [r.category, r.source]]))
}

/** Everything the upgrade could touch, to compare before and after. */
async function snapshot() {
  return {
    categories: await listCategories(ctx.db),
    rules: await listRules(ctx.db),
    transactions: await filed(),
  }
}

describe('upgrading an install set up with the first starter set', () => {
  /** The owner's real life on the first starter set, before the upgrade. */
  async function ownersInstall() {
    await onboardedOwner()
    const first = await firstStarterSet({
      // Edited by the owner: a narrower Health and a new color on Groceries.
      Health: { providerCategories: ['MEDICAL'] },
      Groceries: { color: '#123456' },
    })
    // A category the owner made, under a name the new set also uses.
    const coffee = await createCategory(
      ctx.db,
      categoryInputSchema.parse({ name: 'coffee', color: '#654321', providerCategories: [] }),
    )
    // The owner's own rule for Zwift, filing it under Entertainment.
    await createRule(ctx.db, {
      field: 'merchant',
      matchType: 'contains',
      pattern: 'Zwift',
      minAmountCents: null,
      maxAmountCents: null,
      categoryId: first.get('Entertainment')!.id,
    })

    const { accountId } = await insertBankAccount(ctx.db)
    const add = (name: string, primary: string, detailed: string, amountCents = 2500) =>
      insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-05',
        name,
        merchantName: name,
        amountCents,
        primary,
        detailed,
      })
    await add('TOTAL WINE', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR')
    await add('HYUNDAI MOTOR FINANCE', 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CAR_PAYMENT', 45000)
    await add('NETFLIX.COM', 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES')
    await add('Zwift', 'PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS')
    await add('LIFE TIME FITNESS', 'PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS')
    await add('Zelle payment to JANE DOE', 'TRANSFER_OUT', 'TRANSFER_OUT_ACCOUNT_TRANSFER', 4000)
    const lowry = await add(
      'LOWRY LIQUORS',
      'FOOD_AND_DRINK',
      'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
    )
    await recategorize(ctx.db)
    // The owner filed this one by hand.
    await setCategory(ctx.db, [lowry], first.get('Groceries')!.id)
    return { first, coffee }
  }

  it('files transactions with the more specific categories, keeping hand-picked ones and rule matches', async () => {
    await ownersInstall()
    expect(await filed()).toMatchObject({
      'TOTAL WINE': ['Dining out', 'provider'],
      // Even before the upgrade, a car payment no longer hides as a transfer;
      // with no category for it yet, it waits to be sorted (and still counts).
      'HYUNDAI MOTOR FINANCE': [null, null],
    })

    const result = await upgradeStarterSet(ctx.db)

    expect(await filed()).toEqual({
      'TOTAL WINE': ['Alcohol', 'provider'],
      'HYUNDAI MOTOR FINANCE': ['Car payment', 'provider'],
      'NETFLIX.COM': ['Streaming and apps', 'rule'],
      'LIFE TIME FITNESS': ['Fitness', 'provider'],
      'Zelle payment to JANE DOE': ['Sent to people', 'provider'],
      // Untouched: picked by hand, and matched by the owner's own rule.
      'LOWRY LIQUORS': ['Groceries', 'manual'],
      Zwift: ['Entertainment', 'rule'],
    })
    expect(result).toMatchObject({ recategorized: 5 })
  })

  it('moves untouched first-set categories onto the new codes, keeping their names and budgets', async () => {
    const { first } = await ownersInstall()

    await upgradeStarterSet(ctx.db)

    const after = await byName()
    const transfers = after.get('Transfers')!
    expect(transfers.providerCategories).toEqual(successorOf('Transfers')!.providerCategories)
    expect(transfers.group).toBe('Transfers')
    // An old name keeps its name and takes over its successor's codes.
    const home = after.get('Home and utilities')!
    expect(home.providerCategories).toEqual(successorOf('Utilities')!.providerCategories)
    expect(home).toMatchObject({ id: first.get('Home and utilities')!.id, budgetCents: 12300 })
    expect(after.has('Utilities')).toBe(false)
    expect(after.has('Services')).toBe(false)
  })

  it('never changes what the owner edited or made, beyond a missing group heading', async () => {
    const { first, coffee } = await ownersInstall()

    const result = await upgradeStarterSet(ctx.db)

    const after = await byName()
    expect(after.get('Health')).toEqual({ ...first.get('Health'), group: 'Health and fitness' })
    expect(after.get('Groceries')).toEqual({ ...first.get('Groceries'), group: 'Food and drink' })
    expect(after.get('coffee')).toEqual({ ...coffee, group: 'Food and drink' })
    // Every first-set category is still here, under its own name.
    for (const name of Object.keys(FIRST_STARTER_CODES)) expect(after.has(name)).toBe(true)
    // Ten of eleven: Health's codes were edited, so only it keeps its own.
    expect(result).toMatchObject({ retargeted: 10 })
  })

  it('adds the missing starters without budgets, never twice under one name', async () => {
    await ownersInstall()

    const result = await upgradeStarterSet(ctx.db)

    const names = (await listCategories(ctx.db)).map((c) => c.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    const added = (await listCategories(ctx.db)).filter(
      (c) => !(c.name in FIRST_STARTER_CODES) && c.name !== 'coffee',
    )
    // The eleven first-set names (Utilities and Services among them, by their
    // old names) and the owner's own Coffee are already here.
    expect(added.length).toBe(STARTER_CATEGORIES.length - 12)
    expect(result).toMatchObject({ categoriesAdded: added.length })
    expect(added.every((c) => c.budgetCents === null)).toBe(true)
    expect(added.find((c) => c.name === 'Alcohol')).toMatchObject({
      group: 'Food and drink',
      providerCategories: ['FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR'],
    })
  })

  it("adds starter rules after the owner's, skipping merchants that already have a rule", async () => {
    await ownersInstall()

    const result = await upgradeStarterSet(ctx.db)

    const patterns = (await listRules(ctx.db)).map((r) => r.pattern)
    expect(patterns[0]).toBe('Zwift')
    expect(patterns.filter((p) => p.toLowerCase() === 'zwift')).toHaveLength(1)
    expect(patterns).toHaveLength(STARTER_RULES.length)
    expect(result).toMatchObject({ rulesAdded: STARTER_RULES.length - 1 })
  })

  it('runs once: a second run changes nothing, even after the owner deletes what it added', async () => {
    await ownersInstall()
    await upgradeStarterSet(ctx.db)
    await ctx.db.query(`DELETE FROM categories WHERE name = 'Coffee' OR name = 'Alcohol'`)
    const before = await snapshot()

    expect(await upgradeStarterSet(ctx.db)).toBeNull()

    expect(await snapshot()).toEqual(before)
  })
})

describe('installs the upgrade leaves alone', () => {
  it('skips a fresh install that has not finished setup, which gets the new set at setup', async () => {
    await firstStarterSet()
    const before = await snapshot()

    expect(await upgradeStarterSet(ctx.db)).toBeNull()

    expect(await snapshot()).toEqual(before)
    // Recorded, so it never runs later on an install set up with the new set.
    const { rows } = await ctx.db.query('SELECT name FROM applied_upgrades')
    expect(rows).toEqual([{ name: STARTER_UPGRADE }])
  })

  it('skips an install that started empty or rebuilt its categories by hand', async () => {
    await onboardedOwner()
    await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Groceries' }))
    await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Bourbon' }))
    const before = await snapshot()

    expect(await upgradeStarterSet(ctx.db)).toBeNull()

    expect(await snapshot()).toEqual(before)
  })
})
