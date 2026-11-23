// The tax export for lines a bank code says nothing about, as a file import
// or a hand entry makes them: interest, dividends, support and veterans
// benefits read by their words, and money from people with no category.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { CATEGORIZE_HINT } from '../src/domain/tax/csv.js'
import { actionCaller } from './actionCaller.js'
import { taxYear } from './fixtures/taxYear.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: AppContext
const { call } = actionCaller(() => ctx)
const { category, transaction } = taxYear(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** A checking account and an income category, with deposits filed there by hand. */
async function deposits(lines: [name: string, cents: number][]) {
  const income = await category('Income', 'income')
  const checking = (await insertBankAccount(ctx.db, { name: 'Checking' })).accountId
  for (const [name, cents] of lines) {
    await transaction(checking, '2026-03-01', name, cents, income, { source: 'manual' })
  }
  return checking
}

describe('the tax export of lines with no bank code', () => {
  it('puts interest and dividends on their lines, never in Pay', async () => {
    await deposits([
      ['ACME PAYROLL', -300000],
      ['INTEREST PAID', -1200],
      ['Interest Earned', -300],
      ['DIVIDEND', -2000],
      ['Dividend Deposit', -500],
      ['ACME Dividend Corp PAYROLL', -100000],
    ])
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    expect(summary).toMatchObject({ payCents: 400000, interestCents: 1500, dividendsCents: 2500 })
    expect(summary.income.map((source) => source.source)).toEqual([
      'Acme Payroll',
      'Acme Dividend Corp Payroll',
    ])
    expect(csv).toContain('\r\nInterest,,,,,15.00,\r\n')
    expect(csv).toContain('\r\nDividends,,,,,25.00,\r\n')
  })

  it('keeps support and veterans benefits out of Pay and off every summed line', async () => {
    await deposits([
      ['ACME PAYROLL', -300000],
      ['TX CHILD SUPPORT SDU', -40000],
      ['ALIMONY', -50000],
      ['VA BENEFITS TREAS 310', -150000],
    ])
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    expect(summary.payCents).toBe(300000)
    expect(summary.income).toEqual([{ key: 'acme payroll', source: 'Acme Payroll', cents: 300000 }])
    // The money still counts in its category's total, each row noted.
    expect(summary.categories[0]).toMatchObject({ name: 'Income', totalCents: 540000 })
    expect(csv).toContain(',400.00,"Support payment, not pay"\r\n')
    expect(csv).toContain(',500.00,"Support payment, not pay"\r\n')
    expect(csv).toContain(',1500.00,"Veterans benefits, not pay"\r\n')
    expect(csv).not.toMatch(/Pay from .*(SUPPORT|ALIMONY|VA BENEFITS)/i)
  })

  it('leaves money from people with no category out of what may be income', async () => {
    const checking = (await insertBankAccount(ctx.db, { name: 'Checking' })).accountId
    await transaction(checking, '2026-04-02', 'Zelle from Sam', -5000, null)
    await transaction(checking, '2026-04-03', 'Mystery deposit', -20000, null)
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    // Both rows stay in the uncategorized line, but only one could be pay.
    expect(summary.categories).toMatchObject([
      { name: 'Money in, not categorized', totalCents: 25000, count: 2 },
    ])
    expect(summary.unfiledInCents).toBe(20000)
    expect(csv).toContain(',50.00,"Payment from a person, not pay"\r\n')
    expect(csv).toContain(`\r\nPossible income to categorize,,,,,200.00,"${CATEGORIZE_HINT}"\r\n`)
  })

  it('gives no hint to categorize when only money from people has no category', async () => {
    const checking = (await insertBankAccount(ctx.db, { name: 'Checking' })).accountId
    await transaction(checking, '2026-04-02', 'Zelle from Sam', -5000, null)
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    expect(summary.unfiledInCents).toBe(0)
    expect(csv).toContain('\r\nPossible income to categorize,,,,,0.00,\r\n')
  })
})
