// The plan name kept from a paystub's pension line to name a new pension:
// the plan's own words and number stay, while member numbers, figures and
// the labels printed beside them go. Pure; every name here is made up or a
// public plan's name.

import { describe, expect, it } from 'vitest'
import { redactPlanName } from '../src/domain/paystubs/redact.js'

/** Each line as printed, and the name kept from it. */
type Case = readonly [line: string, name: string | null]

describe('redactPlanName', () => {
  it.each<Case>([
    ['PERS Plan 2', 'PERS Plan 2'],
    ['TRS Plan 3', 'TRS Plan 3'],
    ['IMRF Tier 2', 'IMRF Tier 2'],
    ['NYSLRS Tier 6', 'NYSLRS Tier 6'],
    ['PERS Plan 2 422.95', 'PERS Plan 2'],
    ['PERS Plan 2: 422.95', 'PERS Plan 2'],
  ])('keeps the plan\'s own number in "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

  it.each<Case>([
    ['PERA Tier 10', 'PERA Tier'],
    ['PERA Tier 0', 'PERA Tier'],
    ['PERA 2', 'PERA'],
    ['PERS Plan 2.5', 'PERS Plan'],
  ])('keeps only a lone 1 to 9 after Plan or Tier, so "%s" is "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

  it.each<Case>([
    ['1199SEIU Pension', '1199SEIU Pension'],
    ['1199SEIU Pension 422.95', '1199SEIU Pension'],
  ])('keeps a word with digits joined to letters in "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

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
  ])('cuts member numbers, figures and their labels from "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

  it.each<Case>([
    ['PERA (Member)', 'PERA'],
    ['PERA [Member]', 'PERA'],
    ['PERA (Member) 422.95', 'PERA'],
    ['PERA (ID) A12', 'PERA'],
    ['PERA (Member ID 4417)', 'PERA'],
  ])('drops a bracketed label from "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

  it.each<Case>([
    ['PERA (DB)', 'PERA (DB)'],
    ['PERA (DB) Member 422.95', 'PERA (DB)'],
  ])('keeps a bracketed part of the plan\'s name in "%s"', (line, name) => {
    expect(redactPlanName(line)).toBe(name)
  })

  it('keeps no name when nothing but labels and punctuation is left', () => {
    expect(redactPlanName('(Member) -')).toBeNull()
    expect(redactPlanName('No. 4417')).toBeNull()
    expect(redactPlanName(null)).toBeNull()
  })
})
