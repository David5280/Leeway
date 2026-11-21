import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { csvCell, MAY_BE_DEDUCTIBLE } from '../src/domain/taxExport.js'
import { agentTools } from '../src/mcp/server.js'
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
beforeEach(async () => {
  await resetData(ctx.db)
})

/** A year of money: pay, interest, dividends, a friend paying back, spending and moves between accounts. */
async function seed() {
  const category = async (
    name: string,
    kind: 'expense' | 'income' | 'transfer' = 'expense',
    groupName?: string,
  ) => (await call('create_category', { name, kind, group: groupName })).id
  const income = await category('Income', 'income')
  const fromPeople = await category('Received from people', 'income')
  const health = await category('Health', 'expense', 'Health and fitness')
  const groceries = await category('Groceries')
  const moves = await category('Transfers', 'transfer')
  const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
  const hidden = (await insertBankAccount(ctx.db, { name: 'Old card', hidden: true })).accountId
  const tx = async (
    date: string,
    name: string,
    cents: number,
    categoryId: string | null,
    extra: { detailed?: string; merchantName?: string; account?: string; pending?: boolean } = {},
  ) => {
    const id = await insertBankTransaction(ctx.db, extra.account ?? accountId, {
      date,
      name,
      amountCents: cents,
      detailed: extra.detailed ?? null,
      merchantName: extra.merchantName ?? null,
      pending: extra.pending,
    })
    await ctx.db.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [categoryId, id])
    return id
  }
  await tx('2026-01-15', 'ACME PAYROLL', -300000, income, {
    merchantName: 'Acme Corp',
    detailed: 'INCOME_WAGES',
  })
  await tx('2026-02-15', 'ACME PAYROLL', -300000, income, {
    merchantName: 'Acme Corp',
    detailed: 'INCOME_WAGES',
  })
  await tx('2026-03-01', 'SIDE GIG LLC', -50000, income, { merchantName: 'Side Gig' })
  await tx('2026-03-31', 'INTEREST PAID', -1500, income, { detailed: 'INCOME_INTEREST_EARNED' })
  await tx('2026-06-30', 'DIVIDEND', -2500, income, { detailed: 'INCOME_DIVIDENDS' })
  await tx('2026-04-02', 'Zelle from Sam', -5000, fromPeople)
  await tx('2026-05-01', 'Clawback', 1000, income, { merchantName: 'Clawback Co' })
  await tx('2026-04-10', 'CVS PHARMACY', 12000, health)
  await tx('2026-04-11', 'Whole Foods, Market', 8000, groceries, {
    merchantName: 'Whole Foods, Market',
  })
  const refund = await tx('2026-04-12', 'Whole Foods refund', -1000, groceries)
  await tx('2026-04-13', 'Corner store', 3000, null)
  // None of these count: a move between own accounts, an excluded line, a hidden account, pending, last year.
  await tx('2026-05-01', 'To savings', 50000, moves)
  const excluded = await tx('2026-05-02', 'Reimbursed lunch', 4000, groceries)
  await ctx.db.query('UPDATE transactions SET excluded = true WHERE id = $1', [excluded])
  await tx('2026-05-03', 'Old card spend', 9000, groceries, { account: hidden })
  await tx('2026-05-04', 'Pending', 9000, groceries, { pending: true })
  await tx('2025-12-31', 'Last year', 9000, groceries)
  await ctx.db.query(`UPDATE transactions SET note = '=HYPERLINK("x")' WHERE id = $1`, [refund])
}

describe('the tax export', () => {
  it('sums the year by category, flagging the ones that may be deductible', async () => {
    await seed()
    const { summary, filename } = await call('export_tax_year', { year: 2026 })
    expect(filename).toBe('leeway-2026-tax-summary.csv')
    expect(
      summary.categories.map((c) => [c.name, c.kind, c.totalCents, c.count, c.mayBeDeductible]),
    ).toEqual([
      ['Income', 'income', 653000, 6, false],
      ['Received from people', 'income', 5000, 1, false],
      ['Health', 'expense', 12000, 1, true],
      ['Groceries', 'expense', 7000, 2, false],
      ['Not categorized', null, 3000, 1, false],
    ])
    expect(summary.categories[2]!.group).toBe('Health and fitness')
  })

  it('lists pay by who paid it, apart from people paying back, with interest and dividends', async () => {
    await seed()
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.income).toEqual([
      { source: 'Acme Corp', cents: 600000 },
      { source: 'Side Gig', cents: 50000 },
    ])
    expect(summary).toMatchObject({ payCents: 649000, interestCents: 1500, dividendsCents: 2500 })
  })

  it('writes a CSV grouped by category, each with a total line', async () => {
    await seed()
    const { csv } = await call('export_tax_year', { year: 2026 })
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('Category,Group,Date,Name,Account,Amount,Note')
    expect(lines).toContain(`Total: Health,,,,,120.00,"${MAY_BE_DEDUCTIBLE}"`)
    expect(lines).toContain(
      'Health,Health and fitness,2026-04-10,CVS Pharmacy,Test Everyday,120.00,',
    )
    expect(lines).toContain('Total: Income,,,,,6530.00,')
    expect(lines).toContain('Groceries,,2026-04-11,"Whole Foods, Market",Test Everyday,80.00,')
    expect(lines.find((line) => line.includes('2026-04-12'))).toMatch(
      /,-10\.00,"'=HYPERLINK\(""x""\)"$/,
    )
    expect(lines.find((line) => line.includes('2026-01-15'))).toMatch(/,3000\.00,$/)
    expect(csv).not.toContain('Last year')
    expect(csv).not.toContain('To savings')
    // Five categories: their lines, five totals and the header.
    expect(lines).toHaveLength(1 + 11 + 5)
  })

  it('is just the header for a year with nothing in it', async () => {
    const { csv, summary } = await call('export_tax_year', { year: 2020 })
    expect(csv).toBe('Category,Group,Date,Name,Account,Amount,Note\r\n')
    expect(summary).toMatchObject({ categories: [], income: [], payCents: 0 })
  })

  it('stays in the app, out of every agent tool list', () => {
    expect(findAction('export_tax_year')).toMatchObject({ surface: 'app', scope: 'read' })
    expect(agentTools('write').map((tool) => tool.name)).not.toContain('export_tax_year')
  })

  it('takes a year from 2000 to 2100', async () => {
    expect(await callError('export_tax_year', { year: 1999 })).toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('csvCell', () => {
  it('quotes what needs quoting and keeps a spreadsheet from running a formula', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('=1+2')).toBe("'=1+2")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })
})
