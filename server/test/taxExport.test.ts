import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { MAY_BE_DEDUCTIBLE } from '../src/domain/tax/classify.js'
import { CATEGORIZE_HINT, CSV_HEADER } from '../src/domain/tax/csv.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import { CARD_PAYMENT, taxYear } from './fixtures/taxYear.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)
const { category, transaction, checkingAndHiddenCard, seed } = taxYear(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('the tax export', () => {
  it('sums the year by category, money in first, flagging the ones that may be deductible', async () => {
    const { namedLikeNone } = await seed()
    const { summary, filename } = await call('export_tax_year', { year: 2026 })
    expect(filename).toBe('leeway-2026-tax-summary.csv')
    expect(
      summary.categories.map((c) => [c.name, c.moneyIn, c.totalCents, c.count, c.mayBeDeductible]),
    ).toEqual([
      ['Income', true, 658000, 7, false],
      ['Received from people', true, 7000, 1, false],
      ['Money in, not categorized', true, 20000, 1, false],
      ['Groceries', false, 22000, 4, false],
      ['Health', false, 12000, 1, true],
      ['Not categorized', false, 2500, 1, false],
      ['Money out, not categorized', false, 3000, 1, false],
    ])
    expect(summary.categories[4]!.group).toBe('Health and fitness')
    // A category the owner named "Not categorized" stays apart from money with no category.
    expect(summary.categories.slice(5).map((c) => c.id)).toEqual([namedLikeNone, null])
  })

  it('keeps money in with no category apart from spending, and from pay', async () => {
    await seed()
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.unfiledInCents).toBe(20000)
    expect(summary.categories.find((c) => c.id === null && !c.moneyIn)!.totalCents).toBe(3000)
  })

  it('lists pay by who paid it, netted so the sources add up to Pay', async () => {
    await seed()
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.income).toEqual([
      { key: 'acme corp', source: 'Acme Corp', cents: 600000 },
      { key: 'side gig', source: 'Side Gig', cents: 50000 },
      { key: 'clawback co', source: 'Clawback Co', cents: -1000 },
    ])
    expect(summary).toMatchObject({ payCents: 649000, interestCents: 1500, dividendsCents: 2500 })
    expect(summary.income.reduce((sum, source) => sum + source.cents, 0)).toBe(summary.payCents)
  })

  it("counts hidden accounts' spending and pay, but never a move to or from one", async () => {
    await seed()
    const { csv, summary } = await call('export_tax_year', { year: 2026 })
    // Half of Acme's pay landed in the old bank, now hidden.
    expect(summary.income[0]).toMatchObject({ source: 'Acme Corp', cents: 600000 })
    expect(csv).toMatch(/,2026-05-20,[^,]+,Test Old card,60\.00,/)
    expect(csv).toContain('2026-12-31,Old bank groceries,Test Old bank,90.00,')
    for (const move of [
      'To savings',
      'To old bank',
      'From everyday',
      'Card Payment',
      'Withdrawal',
    ]) {
      expect(csv).not.toContain(move)
    }
    expect(csv).not.toMatch(/Payment Received|,Deposit,/)
  })

  it('writes a CSV grouped by category, each with a total line, then the summary', async () => {
    await seed()
    const { csv } = await call('export_tax_year', { year: 2026 })
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(CSV_HEADER)
    expect(lines).toContain(`Total: Health,,,,,120.00,"${MAY_BE_DEDUCTIBLE}"`)
    expect(lines).toContain(
      'Health,Health and fitness,2026-04-10,CVS Pharmacy,Test Everyday,120.00,',
    )
    expect(lines).toContain('Total: Income,,,,,6580.00,')
    expect(lines).toContain('Income,,2026-01-01,Acme Corp,Test Everyday,3000.00,')
    expect(lines).toContain('Groceries,,2026-04-11,"Whole Foods, Market",Test Everyday,80.00,')
    expect(lines).toContain('"Total: Money in, not categorized",,,,,200.00,')
    expect(lines.find((line) => line.includes('2026-04-12'))).toMatch(
      /,-10\.00,"'=HYPERLINK\(""x""\)"$/,
    )
    expect(csv).not.toContain('Last year')
    expect(csv).not.toContain('Next year')
    // Seven categories: 16 transaction lines, seven totals and the header, then the summary.
    expect(lines.indexOf('')).toBe(1 + 16 + 7)
  })

  it('notes income that is not pay, so the Income total reads clearly', async () => {
    await seed()
    const { csv } = await call('export_tax_year', { year: 2026 })
    const lines = csv.split('\r\n')
    expect(lines.find((line) => line.includes('2026-04-02'))).toMatch(
      /,50\.00,"Payment from a person, not pay"$/,
    )
    expect(lines.find((line) => line.includes('2026-04-03'))).toMatch(
      /,70\.00,"Money moved in from another account, not pay"$/,
    )
  })

  it('notes interest and dividends filed as income, which have their own lines', async () => {
    await seed()
    const { csv } = await call('export_tax_year', { year: 2026 })
    expect(csv).toContain(',2026-03-31,Interest Paid,Test Everyday,15.00,"Interest, not pay"\r\n')
    expect(csv).toContain(',2026-06-30,Dividend,Test Everyday,25.00,"Dividends, not pay"\r\n')
  })

  it('ends with the summary block, for anyone who only gets the file', async () => {
    await seed()
    const { csv } = await call('export_tax_year', { year: 2026 })
    const block = csv.trimEnd().split('\r\n\r\n')[1]!.split('\r\n')
    expect(block).toEqual([
      'Summary for 2026,,,,,Amount,"A summary of what happened, not tax advice"',
      'Pay,,,,,6490.00,',
      'Pay from Acme Corp,,,,,6000.00,',
      'Pay from Side Gig,,,,,500.00,',
      'Pay from Clawback Co,,,,,-10.00,',
      'Interest,,,,,15.00,',
      'Dividends,,,,,25.00,',
      'Unemployment benefits,,,,,0.00,',
      'Social Security benefits,,,,,0.00,',
      'Pension and retirement,,,,,0.00,',
      'Tax refunds,,,,,0.00,',
      'Card rewards and cash back,,,,,0.00,',
      `Possible income to categorize,,,,,200.00,"${CATEGORIZE_HINT}"`,
    ])
  })

  it('keeps a tax refund out of Pay, on its own line', async () => {
    const income = await category('Income', 'income')
    const { checking } = await checkingAndHiddenCard()
    await transaction(checking, '2026-01-15', 'ACME PAYROLL', -300000, income, {
      merchantName: 'Acme Corp',
      detailed: 'INCOME_WAGES',
    })
    await transaction(checking, '2026-04-20', 'IRS TREAS 310 TAX REF', -2500, income, {
      detailed: 'INCOME_TAX_REFUND',
    })
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    expect(summary).toMatchObject({ payCents: 300000, taxRefundCents: 2500 })
    expect(summary.income.map((source) => source.source)).toEqual(['Acme Corp'])
    expect(csv).toContain('\r\nTax refunds,,,,,25.00,\r\n')
    expect(csv).toContain(',25.00,"Tax refund, not pay"\r\n')
  })

  it('counts a hidden card payment filed by hand as spending only once', async () => {
    const shopping = await category('Shopping')
    const debt = await category('Debt payments')
    const moves = await category('Transfers', 'transfer')
    const { checking, card } = await checkingAndHiddenCard()
    await transaction(card, '2026-06-01', 'BEST BUY', 50000, shopping)
    await transaction(checking, '2026-06-03', 'CHASE CREDIT CRD AUTOPAY', 50000, debt, {
      detailed: CARD_PAYMENT,
      source: 'manual',
    })
    await transaction(card, '2026-06-04', 'AUTOMATIC PAYMENT', -50000, moves)
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.categories.map((c) => [c.name, c.totalCents])).toEqual([['Shopping', 50000]])
  })

  it('keeps a payment to a hidden loan filed as spending, since a loan has no purchases', async () => {
    const debt = await category('Debt payments')
    const moves = await category('Transfers', 'transfer')
    const { checking } = await checkingAndHiddenCard()
    const loan = (await insertBankAccount(ctx.db, { name: 'Car loan', type: 'loan', hidden: true }))
      .accountId
    await transaction(checking, '2026-08-01', 'TRANSFER TO CAR LOAN', 30000, debt, {
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      source: 'manual',
    })
    await transaction(loan, '2026-08-02', 'PAYMENT', -30000, moves)
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.categories.map((c) => [c.name, c.totalCents])).toEqual([
      ['Debt payments', 30000],
    ])
  })

  it('keeps rent a rule files, though a hidden card took an equal payment from elsewhere', async () => {
    const rent = await category('Rent')
    const shopping = await category('Shopping')
    await call('create_rule', { pattern: 'landlord', field: 'description', categoryId: rent })
    const { checking, card } = await checkingAndHiddenCard()
    await transaction(checking, '2026-05-01', 'ONLINE TRANSFER TO LANDLORD', 150000, rent, {
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      source: 'rule',
    })
    await transaction(card, '2026-05-02', 'PAYMENT THANK YOU', -150000, null)
    await transaction(card, '2026-04-20', 'IKEA', 150000, shopping)
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.categories.map((c) => [c.name, c.totalCents])).toEqual([
      ['Rent', 150000],
      ['Shopping', 150000],
    ])
    // The card's payment from an account Leeway cannot see is not money in.
    expect(summary.unfiledInCents).toBe(0)
  })

  it("still counts a card's refund as money in, and leaves out an unfiled loan payment", async () => {
    const { card } = await checkingAndHiddenCard()
    const loan = (await insertBankAccount(ctx.db, { name: 'Car loan', type: 'loan', hidden: true }))
      .accountId
    await transaction(card, '2026-03-02', 'IKEA REFUND', -5000, null)
    await transaction(card, '2026-03-03', 'BEST BUY CREDIT', -2000, null, {
      detailed: 'GENERAL_MERCHANDISE_ELECTRONICS',
    })
    await transaction(loan, '2026-03-04', 'PAYMENT', -30000, null, {
      detailed: 'LOAN_PAYMENTS_CAR_PAYMENT',
    })
    const { summary, csv } = await call('export_tax_year', { year: 2026 })
    expect(summary.unfiledInCents).toBe(7000)
    expect(csv).not.toContain('Test Car loan')
  })

  it('keeps a real deposit that a closer date would have paired with a card payment', async () => {
    const debt = await category('Debt payments')
    const moves = await category('Transfers', 'transfer')
    const { checking, card } = await checkingAndHiddenCard()
    const savings = (await insertBankAccount(ctx.db, { name: 'Savings' })).accountId
    await transaction(checking, '2026-06-03', 'CARD AUTOPAY', 50000, debt, {
      detailed: CARD_PAYMENT,
    })
    await transaction(card, '2026-06-05', 'AUTOMATIC PAYMENT', -50000, moves)
    await transaction(savings, '2026-06-03', 'DEPOSIT', -50000, null)
    const { summary } = await call('export_tax_year', { year: 2026 })
    expect(summary.unfiledInCents).toBe(50000)
    expect(summary.categories.map((c) => c.name)).toEqual(['Money in, not categorized'])
  })

  it('is the header and an empty summary for a year with nothing in it', async () => {
    const { csv, summary } = await call('export_tax_year', { year: 2020 })
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      CSV_HEADER,
      '',
      expect.stringMatching(/^Summary/),
    ])
    expect(csv).toContain('\r\nPossible income to categorize,,,,,0.00,\r\n')
    expect(summary).toMatchObject({ categories: [], income: [], payCents: 0, unfiledInCents: 0 })
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
