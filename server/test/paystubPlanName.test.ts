// The plan name kept from a paystub's pension line to name a new pension:
// the plan's own words and numbers stay, while member numbers, figures, a
// member's name and the labels printed beside them go. Pure; every name here
// is made up or a public plan's name. More shapes are in
// paystubPlanNameAllowList.test.ts.

import { describe, expect, it } from 'vitest'
import { redactPlanName } from '../src/domain/paystubs/planName.js'

/** Each line as printed, and the name kept from it. */
type Case = readonly [line: string, name: string | null]

const keeps = (line: string, name: string | null) => expect(redactPlanName(line)).toBe(name)

describe('redactPlanName keeps a plan name in the shapes digits take there', () => {
  it.each<Case>([
    ['PERS Plan 2', 'PERS Plan 2'],
    ['TRS Plan 3', 'TRS Plan 3'],
    ['IMRF Tier 2', 'IMRF Tier 2'],
    ['NYSLRS Tier 6', 'NYSLRS Tier 6'],
    ['PERA Tier 10', 'PERA Tier 10'],
    ['PERS Plan 2 422.95', 'PERS Plan 2'],
    ['PERS Plan 2: 422.95', 'PERS Plan 2'],
  ])('keeps the plan\'s own number in "%s"', keeps)

  it.each<Case>([
    ['1199SEIU Pension', '1199SEIU Pension'],
    ['32BJ Pension 422.95', '32BJ Pension'],
    ['401(a)', '401(a)'],
    ['457(b)', '457(b)'],
    ['403(b) Plan', '403(b) Plan'],
  ])('keeps a union local or a tax code section in "%s"', keeps)

  it.each<Case>([
    ['CalPERS PEPRA', 'CalPERS PEPRA'],
    ['PERA (DB)', 'PERA (DB)'],
    ['PERA (DB) Member 422.95', 'PERA (DB)'],
  ])('keeps a name with no digits whole in "%s"', keeps)
})

describe('redactPlanName cuts what may be a member number', () => {
  it.each<Case>([
    ['PERA Tier 0', 'PERA Tier'],
    ['PERA Tier 100', 'PERA Tier'],
    ['PERA 2', 'PERA'],
    ['PERS Plan 2.5', 'PERS Plan'],
  ])('keeps only a 1 to 99 after Plan or Tier, so "%s" is "%s"', keeps)

  it.each<Case>([
    ['PERA A1234', 'PERA'],
    ['PERA M42', 'PERA'],
    ['PERA Mbr4417', 'PERA'],
    ['PERA ID:4417', 'PERA'],
    ['PERA ID4417', 'PERA'],
    ['PERA No.4417', 'PERA'],
    ['PERA No4417', 'PERA'],
    ['PERA Mbr:4417', 'PERA'],
    ['PERA EE1234', 'PERA'],
    ['PERA 4417A', 'PERA'],
    ['PERA 1234-A', 'PERA'],
    ['PERA (A1234)', 'PERA'],
    ['PERA (M42)', 'PERA'],
    ['PERA Plan 2 A123', 'PERA Plan 2'],
  ])('cuts a member number of letters and digits from "%s"', keeps)

  it.each<Case>([
    ['PERA Mbr 1234', 'PERA'],
    ['PERA 4417', 'PERA'],
    ['PERA #4417', 'PERA'],
    ['PERA No. 4417', 'PERA'],
    ['PERA ID: A12', 'PERA'],
    ['PERA: 422.95', 'PERA'],
    ['PERA Member 11.00% 422.95', 'PERA'],
    ['Colorado PERA EE Pre-tax $422.95', 'Colorado PERA'],
    ['Member 422.95', null],
  ])('cuts member numbers, figures and their labels from "%s"', keeps)
})

describe('redactPlanName cuts labels and what follows a member label', () => {
  it.each<Case>([
    ['PERA Member: SMITH J 4417', 'PERA'],
    ['PERA Mbr Smith J', 'PERA'],
    ['PERA Member', 'PERA'],
  ])('ends the name at a member label in "%s"', keeps)

  it.each<Case>([
    ['Member Retirement Plan', 'Member Retirement Plan'],
    // A leading member word keeps the name only before a plan word, so a
    // person's name after it is never kept.
    ['Member Jane Doe 4417', null],
    ['Mbr: Jane Doe PERA 422.95', 'PERA'],
    ['Member Name Jane Doe', null],
    ['Member Pension Plan 4417', 'Member Pension Plan'],
    ['Mbr Retirement Plan 422.95', 'Mbr Retirement Plan'],
    ['Member Retirement Plan Member 4417', 'Member Retirement Plan'],
  ])('keeps a member word that begins the name in "%s"', keeps)

  it.each<Case>([
    ['PERA (Member)', 'PERA'],
    ['PERA [Member]', 'PERA'],
    ['PERA (Member) 422.95', 'PERA'],
    ['PERA (ID) A12', 'PERA'],
    ['PERA (Member ID 4417)', 'PERA'],
  ])('drops a bracketed label from "%s"', keeps)

  it('keeps no name when nothing but labels and punctuation is left', () => {
    expect(redactPlanName('(Member) -')).toBeNull()
    expect(redactPlanName('No. 4417')).toBeNull()
    expect(redactPlanName(null)).toBeNull()
  })
})

describe('redactPlanName never keeps a person’s name', () => {
  it.each<Case>([
    ['PERA Employee Jane Doe 11.00% 422.95', 'PERA'],
    ['PERA EE Jane Doe', 'PERA'],
    ['PERA Contribution Jane Doe', 'PERA'],
    ['PERA Participant Jane Doe', 'PERA'],
    ['PERA EMPLOYEE JANE DOE', 'PERA'],
    ['Colorado PERA Deduction Doe J', 'Colorado PERA'],
  ])('ends the name at the label before the person in "%s"', keeps)

  it.each<Case>([
    ['PERA Doe, Jane', 'PERA'],
    ['PERA DOE, JANE 422.95', 'PERA'],
    ['Colorado PERA Doe, Jane', 'Colorado PERA'],
  ])('drops a surname written before the given name in "%s"', keeps)

  it.each<Case>([
    ['PERA Jane Doe', 'PERA'],
    ['CalPERS Jane Q Doe 422.95', 'CalPERS'],
    ['PERS Plan 2 Jane Doe', 'PERS Plan 2'],
    ['Jane Doe 422.95', null],
    ['PERA JANE DOE', 'PERA'],
  ])('drops a person’s name left after the plan’s own words in "%s"', keeps)

  it.each<Case>([
    ['PERA', 'PERA'],
    ['CalPERS', 'CalPERS'],
    ['State Employees Retirement System', 'State Employees Retirement System'],
    ['Teamsters Pension Plan', 'Teamsters Pension Plan'],
    ['Teamsters Pension Plan, Western Conference', 'Teamsters Pension Plan'],
    ['401(k) Plan', '401(k) Plan'],
    ['Employee Retirement Plan', 'Employee Retirement Plan'],
    ['Employees Pension Plan 422.95', 'Employees Pension Plan'],
    ['Employee Pre-tax Savings Plan', 'Employee Pre-tax Savings Plan'],
    ['Defined Contribution Plan', 'Defined Contribution Plan'],
    ['Teachers Retirement System of Texas', 'Teachers Retirement System of Texas'],
    ['Police and Fire Pension Fund EE 422.95', 'Police and Fire Pension Fund'],
  ])('keeps a real plan’s name in "%s"', keeps)
})
