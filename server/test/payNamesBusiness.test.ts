// Whether a deposit names a business (domain/pay/deposits.ts), the one test
// for showing a payer's name to the AI, MCP, profile or digest: a business
// ending names a business, while a state after a person's name ("JANE DOE
// CO") names no one. Every name here is made up.

import { describe, expect, it } from 'vitest'
import { namesBusiness } from '../src/domain/pay/deposits.js'

describe('a deposit that names a business', () => {
  const names = (name: string, merchantName: string | null = null) =>
    namesBusiness({ name, merchantName })

  it('reads the ending of a business name, in the bank text or the merchant name', () => {
    expect(names('ACME CORP DIR DEP')).toBe(true)
    expect(names('BLUTH CO PAYROLL')).toBe(true)
    expect(names('ORIG CO NAME:ACME CORP ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(true)
    expect(names('DIRECT DEP', 'Initech LLC')).toBe(true)
  })

  it("never reads an ACH line's own labels or a trailing state as a company", () => {
    expect(names('ORIG CO NAME:JOHN SMITH ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(false)
    expect(names('JOHN SMITH DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD')).toBe(false)
    expect(names('JANE DOE DENVER CO')).toBe(false)
    expect(names('JOHN SMITH DIR DEP')).toBe(false)
  })

  it('never reads the state ending an ACH payer or a transfer sender as a company', () => {
    expect(names('JOHN SMITH DENVER CO DES:PAYROLL ID:1234 INDN:SMITH JOHN CO ID:999 PPD')).toBe(
      false,
    )
    expect(names('JANE DOE CO DES:PAYROLL ID:1 INDN:X CO ID:9 PPD')).toBe(false)
    expect(
      names('ORIG CO NAME:JOHN SMITH DENVER CO ORIG ID:12 DESC DATE: CO ENTRY DESCR:DIR DEP'),
    ).toBe(false)
    expect(names('ORIG CO NAME:JANE DOE CO CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(false)
    expect(names('Transfer from Jane Doe CO salary')).toBe(false)
  })

  // A word between the state and the pay word (how often, the ACH rails)
  // leaves a person a person, and a business a business.
  it.each([
    ['JANE DOE CO WEEKLY PAYROLL', false],
    ['JOHN SMITH DENVER CO ACH PAYROLL', false],
    ['JANE DOE CO MONTHLY SALARY', false],
    ['JANE DOE DENVER CO EFT PAYROLL', false],
    ['JANE DOE CO BIWEEKLY DIR DEP PPD', false],
    ['JANE DOE CO SEMI-MONTHLY PAYROLL REF 12', false],
    ['Jane Doe Co DES:PAYROLL ID:1', false],
    ['ACME CO WEEKLY PAYROLL', true],
    ['Acme Co Payroll', true],
    ['3M CO DES:PAYROLL', true],
    ['ACME INC ACH PAYROLL', true],
    ['GREAT DIVIDE BREWING CO PAYROLL', true],
    ['ACME LLC DENVER CO PAYROLL', true],
    ['IDEAL CO PAYROLL', true],
  ])('reads %j as naming a business: %s', (name, business) => {
    expect(names(name)).toBe(business)
  })

  // Whatever follows a person's "CO" (how often, a bonus, a date, the ACH
  // rails, a trailing dot), the person stays unnamed.
  it.each([
    'JANE DOE CO BI-WEEKLY PAY',
    'JANE DOE CO PAY',
    'JANE DOE CO DES:PAY ID:1',
    'JANE DOE CO PAYROLL 12',
    'JANE DOE CO PAYROLL NOV 15',
    'JANE DOE CO SEMI MONTHLY PAYROLL',
    'JANE DOE CO BI WEEKLY PAYROLL',
    'JANE DOE CO WKLY PAYROLL',
    'JANE DOE CO. PAYROLL',
    'JANE DOE CO BONUS PAYROLL',
    'JANE DOE CO PAYROLL PMT',
    'JANE DOE CO ACH CREDIT PAYROLL',
    'JANE DOE CO PAYROLL CREDIT',
    'JANE DOE CO PAYROLL TRANSFER',
    'JANE DOE CO DD',
    'JANE DOE CO SALARY 15',
    'Transfer from Jane Doe Co bi-weekly pay',
    'From Jane Doe Co payroll bonus',
  ])('never reads a person in Colorado as a company: %j', (name) => {
    expect(names(name)).toBe(false)
  })

  it.each([
    'ACME & CO PAYROLL',
    'SMITH AND CO PAYROLL',
    'ACME CO DENVER CO PAYROLL',
    'FORD MOTOR CO PAYROLL',
    'ACME CO BONUS PAYROLL',
    'ACME CO PAYROLL 12',
    'ACME COMPANY PAYROLL',
    'ADP PAYROLL FOR ACME INC',
    'Acme Co. Payroll',
  ])('still reads a business, whatever follows its ending: %j', (name) => {
    expect(names(name)).toBe(true)
  })

  it('reads a transfer by its sender, a business or a person', () => {
    expect(names('Transfer from Acme Co salary')).toBe(true)
    expect(names('From Initech Inc. paycheck')).toBe(true)
    expect(names('Transfer from Jane Doe Co salary')).toBe(false)
    expect(names('From Jane Doe co-worker paycheck')).toBe(false)
  })

  it('still reads a business ending in Co in an ACH line', () => {
    expect(names('ACME CO DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD')).toBe(true)
    expect(names('3M CO DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD')).toBe(true)
    expect(names('ORIG CO NAME:ACME INC ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(true)
    expect(names('GREAT DIVIDE BREWING CO DES:PAYROLL ID:1 INDN:X CO ID:9 PPD')).toBe(true)
  })
})
