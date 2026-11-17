import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { AMOUNT_BOUNDS_MESSAGE } from '../src/domain/rules.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})

// A well-formed id that matches no rule or category.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

let accountId: string
let coffee: { id: string }
let dining: { id: string }

beforeEach(async () => {
  await resetData(ctx.db)
  accountId = (await insertBankAccount(ctx.db)).accountId
  coffee = await call('create_category', { name: 'Coffee' })
  dining = await call('create_category', { name: 'Dining' })
})

/** A bank transaction on the shared test account. */
const spend = (name: string, amountCents: number, merchantName: string | null = null) =>
  insertBankTransaction(ctx.db, accountId, { date: '2026-11-10', name, amountCents, merchantName })

const categoryOf = async (id: string) => {
  const { transactions } = await call('list_transactions', { includeExcluded: true })
  return transactions.find((t) => t.id === id)?.categoryId ?? null
}

const patterns = async () => (await call('list_rules')).map((r) => r.pattern)

describe('creating rules', () => {
  it('puts a new rule first unless asked to put it last', async () => {
    await call('create_rule', { pattern: 'first', categoryId: coffee.id })
    await call('create_rule', { pattern: 'newest', categoryId: coffee.id })
    await call('create_rule', { pattern: 'last', categoryId: coffee.id, atEnd: true })

    expect(await patterns()).toEqual(['newest', 'first', 'last'])
  })

  it('refuses a category that does not exist', async () => {
    const error = await callError('create_rule', { pattern: 'x', categoryId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That category does not exist' })
    expect(await patterns()).toEqual([])
  })
})

describe('updating rules', () => {
  it('changes only the given fields and re-sorts transactions', async () => {
    const latte = await spend('Latte', 500, 'Blue Bottle')
    const { rule } = await call('create_rule', {
      pattern: 'blue bottle',
      categoryId: coffee.id,
      minAmountCents: 100,
    })
    expect(await categoryOf(latte)).toBe(coffee.id)

    const { rule: updated, recategorized } = await call('update_rule', {
      id: rule.id,
      categoryId: dining.id,
    })

    expect(updated).toMatchObject({
      id: rule.id,
      pattern: 'blue bottle',
      field: 'merchant',
      minAmountCents: 100,
      categoryId: dining.id,
    })
    expect(recategorized).toBe(1)
    expect(await categoryOf(latte)).toBe(dining.id)
  })

  it('can match on the bank description instead of the merchant', async () => {
    const tx = await spend('SQ *CORNER CAFE', 450, 'Square')
    const { rule } = await call('create_rule', { pattern: 'corner cafe', categoryId: coffee.id })
    expect(await categoryOf(tx)).toBeNull()

    await call('update_rule', { id: rule.id, field: 'description' })

    expect(await categoryOf(tx)).toBe(coffee.id)
  })

  it('refuses bounds where the minimum ends up above the maximum', async () => {
    const { rule } = await call('create_rule', {
      pattern: 'amazon',
      categoryId: coffee.id,
      minAmountCents: 500,
    })

    const error = await callError('update_rule', { id: rule.id, maxAmountCents: 100 })

    expect(error).toMatchObject({ code: 'invalid_input', message: AMOUNT_BOUNDS_MESSAGE })
    expect((await call('list_rules'))[0]).toMatchObject({ maxAmountCents: null })
  })

  it('clears a bound when it is set to null', async () => {
    const { rule } = await call('create_rule', {
      pattern: 'amazon',
      categoryId: coffee.id,
      minAmountCents: 500,
    })

    const { rule: updated } = await call('update_rule', { id: rule.id, minAmountCents: null })

    expect(updated.minAmountCents).toBeNull()
  })

  it('refuses a category that does not exist', async () => {
    const { rule } = await call('create_rule', { pattern: 'x', categoryId: coffee.id })
    const error = await callError('update_rule', { id: rule.id, categoryId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That category does not exist' })
  })

  it('reports an unknown rule as not found', async () => {
    const error = await callError('update_rule', { id: UNKNOWN_ID, pattern: 'x' })
    expect(error).toMatchObject({ code: 'not_found', message: 'Rule not found' })
  })

  it('rejects an empty pattern', async () => {
    const { rule } = await call('create_rule', { pattern: 'x', categoryId: coffee.id })
    expect((await callError('update_rule', { id: rule.id, pattern: '  ' })).code).toBe(
      'invalid_input',
    )
  })
})

describe('deleting rules', () => {
  it('removes the rule and lets its transactions fall back to the next match', async () => {
    const tx = await spend('Starbucks', 650)
    await call('create_rule', { pattern: 'star', categoryId: dining.id, atEnd: true })
    const { rule } = await call('create_rule', { pattern: 'starbucks', categoryId: coffee.id })
    expect(await categoryOf(tx)).toBe(coffee.id)

    expect(await call('delete_rule', { id: rule.id })).toEqual({ deleted: true, recategorized: 1 })

    expect(await patterns()).toEqual(['star'])
    expect(await categoryOf(tx)).toBe(dining.id)
  })

  it('reports an unknown rule as not found', async () => {
    const error = await callError('delete_rule', { id: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'not_found', message: 'Rule not found' })
  })
})

describe('reordering rules', () => {
  it('runs rules in the new order, so a different rule wins', async () => {
    const tx = await spend('Starbucks', 650)
    const { rule: broad } = await call('create_rule', { pattern: 'star', categoryId: dining.id })
    const { rule: exact } = await call('create_rule', {
      pattern: 'starbucks',
      categoryId: coffee.id,
    })
    expect(await categoryOf(tx)).toBe(coffee.id)

    const { rules, recategorized } = await call('reorder_rules', { ids: [broad.id, exact.id] })

    expect(rules.map((r) => r.pattern)).toEqual(['star', 'starbucks'])
    expect(recategorized).toBe(1)
    expect(await categoryOf(tx)).toBe(dining.id)
  })

  it('keeps rules left out of the list after the listed ones, in their old order', async () => {
    const created = []
    for (const pattern of ['d', 'c', 'b', 'a']) {
      created.push((await call('create_rule', { pattern, categoryId: coffee.id })).rule)
    }
    expect(await patterns()).toEqual(['a', 'b', 'c', 'd'])
    const byPattern = new Map(created.map((r) => [r.pattern, r.id]))

    const { rules } = await call('reorder_rules', { ids: [byPattern.get('c')] })

    expect(rules.map((r) => r.pattern)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignores ids that match no rule', async () => {
    const { rule } = await call('create_rule', { pattern: 'only', categoryId: coffee.id })

    const { rules } = await call('reorder_rules', { ids: [UNKNOWN_ID, rule.id] })

    expect(rules.map((r) => r.pattern)).toEqual(['only'])
  })

  it('needs at least one id', async () => {
    expect((await callError('reorder_rules', { ids: [] })).code).toBe('invalid_input')
  })
})

describe('previewing a rule', () => {
  it('honors both amount bounds, inclusive', async () => {
    await spend('AMAZON', 999)
    await spend('AMAZON', 1000)
    await spend('AMAZON', 5000)
    await spend('AMAZON', 5001)

    const preview = await call('preview_rule', {
      pattern: 'amazon',
      minAmountCents: 1000,
      maxAmountCents: 5000,
    })

    expect(preview.matchCount).toBe(2)
    expect(preview.examples.map((t) => t.amountCents).sort()).toEqual([1000, 5000])
  })

  it('refuses to preview a rule whose minimum is above its maximum, as saving would', async () => {
    await expect(
      call('preview_rule', { pattern: 'amazon', minAmountCents: 500, maxAmountCents: 100 }),
    ).rejects.toThrow(AMOUNT_BOUNDS_MESSAGE)
  })

  it('matches the whole text for equals and the beginning for starts_with', async () => {
    await spend('Shell', 4000)
    await spend('Shell Oil 123', 3000)
    await spend('Seashell Shop', 2000)

    const equals = await call('preview_rule', { pattern: 'SHELL', matchType: 'equals' })
    const startsWith = await call('preview_rule', { pattern: 'shell', matchType: 'starts_with' })
    const contains = await call('preview_rule', { pattern: 'shell' })

    expect(equals.examples.map((t) => t.name)).toEqual(['Shell'])
    expect(startsWith.matchCount).toBe(2)
    expect(contains.matchCount).toBe(3)
  })

  it('matches the merchant name by default and the bank description when asked', async () => {
    await spend('SQ *CORNER CAFE', 450, 'Square')
    await spend('CORNER CAFE', 500)

    const byMerchant = await call('preview_rule', { pattern: 'corner cafe' })
    const byDescription = await call('preview_rule', {
      pattern: 'corner cafe',
      field: 'description',
    })

    // With no merchant name, the merchant field falls back to the description.
    expect(byMerchant.examples.map((t) => t.name)).toEqual(['CORNER CAFE'])
    expect(byDescription.matchCount).toBe(2)
  })

  it('counts what would move, leaving hand-picked and already-placed transactions alone', async () => {
    const uncategorized = await spend('Bean Co', 400)
    const inDining = await spend('Bean Co', 450)
    const inCoffee = await spend('Bean Co', 500)
    const handPicked = await spend('Bean Co', 550)
    // Exact amount bounds place one transaction in each category by rule.
    const exactly = (amountCents: number) => ({
      minAmountCents: amountCents,
      maxAmountCents: amountCents,
    })
    await call('create_rule', { pattern: 'bean', categoryId: dining.id, ...exactly(450) })
    await call('create_rule', { pattern: 'bean', categoryId: coffee.id, ...exactly(500) })
    await call('categorize_transactions', { ids: [handPicked], categoryId: dining.id })

    const preview = await call('preview_rule', { pattern: 'bean co', categoryId: coffee.id })

    expect(preview.matchCount).toBe(4)
    expect(preview.wouldMove).toBe(2)
    expect(preview.movingFrom).toEqual(
      expect.arrayContaining([
        { categoryId: dining.id, count: 1 },
        { categoryId: null, count: 1 },
      ]),
    )
    expect(preview.movingFrom).toHaveLength(2)
    // A preview changes nothing.
    expect(await categoryOf(uncategorized)).toBeNull()
    expect(await categoryOf(inDining)).toBe(dining.id)
    expect(await categoryOf(inCoffee)).toBe(coffee.id)
  })

  it('reports nothing moving when no category is given', async () => {
    await spend('Bean Co', 400)
    const preview = await call('preview_rule', { pattern: 'bean' })
    expect(preview).toMatchObject({ matchCount: 1, wouldMove: 0, movingFrom: [] })
  })

  it('shows at most ten examples and skips excluded transactions', async () => {
    for (let i = 1; i <= 12; i++) await spend(`Taco ${i}`, 100 * i)
    const excluded = await spend('Taco dupe', 100)
    await call('update_transaction', { id: excluded, excluded: true })

    const preview = await call('preview_rule', { pattern: 'taco' })

    expect(preview.matchCount).toBe(12)
    expect(preview.examples).toHaveLength(10)
  })
})
