// redactPlanName keeps only a plan's own vocabulary, so a person's name in
// any shape around the plan never survives, while real plan names, in any
// case, keep every word they need. Pure; every person here is made up and
// every plan is a public plan's or provider's name.

import { describe, expect, it } from 'vitest'
import { redactPlanName } from '../src/domain/paystubs/planName.js'

/** Each line as printed, and the name kept from it. */
type Case = readonly [line: string, name: string | null]

const keeps = (line: string, name: string | null) => expect(redactPlanName(line)).toBe(name)

describe('redactPlanName drops a person in every shape around the plan', () => {
  it.each<Case>([
    ['CalPERS JANE DOE', 'CalPERS'],
    ['PERA Plan 2 JANE DOE', 'PERA Plan 2'],
    ['Ohio PERS JANE DOE', 'Ohio PERS'],
    ['Teamsters JANE DOE', 'Teamsters'],
    ['PERA JANE Q. DOE', 'PERA'],
  ])('drops an all capitals name after the plan in "%s"', keeps)

  it.each<Case>([
    ['Jane Doe PERA', 'PERA'],
    ['Jane Doe CalPERS', 'CalPERS'],
    ['Jane Doe Retirement Plan', 'Retirement Plan'],
    ['JANE DOE OHIO PERS', 'PERS'],
    ['Jane Washington PERA', 'PERA'],
  ])('drops a name before the plan in "%s"', keeps)

  it.each<Case>([
    ['PERA (Jane Doe)', 'PERA'],
    ['PERA/Jane Doe', 'PERA'],
    ['PERA-Jane Doe', 'PERA'],
    ['PERA [Doe, Jane]', 'PERA'],
    ['Retirement Plan - Jane Doe', 'Retirement Plan'],
    ['Retirement Plan \u2013 Jane Doe', 'Retirement Plan'],
  ])('drops a name set off by punctuation in "%s"', keeps)

  it.each<Case>([
    ['PERA Jane Doe 401(a)', 'PERA 401(a)'],
    ['CalPERS Jane Doe Pension', 'CalPERS Pension'],
  ])('drops a name before more plan words in "%s"', keeps)

  it.each<Case>([
    ['PERA Jane', 'PERA'],
    ['PERA Doe', 'PERA'],
    ['PERA Doe Jr, Jane', 'PERA'],
    ['PERA Jane Q Doe', 'PERA'],
    ['PERA Jane Q. Doe', 'PERA'],
    ['Doe, Jane Employee 401(k)', 'Employee 401(k)'],
    ['Jane Doe', null],
    ['DOE, JANE Q', null],
  ])('drops one word names, initials and surnames first in "%s"', keeps)

  it.each<Case>([
    ['PERA Jane Roth', 'PERA'],
    ['PERA Ira Glass', 'PERA'],
    ['Ira Glass PERA', 'PERA'],
    ['Ira Doe', null],
    ['Roth', null],
    ['Roth Roth', null],
    ['PERA Roth, Ira', 'PERA'],
    ['PERA Roth Ira', 'PERA'],
    ['Roth, Ira 401k', '401k'],
    ['Sep, Ira PERA', 'PERA'],
    // A lone surname right before a tax code reads as a Roth account: a known residual.
    ['Jane Roth 401k', 'Roth 401k'],
  ])('drops Roth and Ira read as names in "%s"', keeps)

  it.each<Case>([
    ['ROTH IRA', 'ROTH IRA'],
    ['roth ira', 'roth ira'],
    ['SEP-IRA', 'SEP IRA'],
    ['Vanguard IRA', 'Vanguard'],
    ['Traditional IRA', null],
  ])('keeps an IRA kind only as one written phrase in "%s"', keeps)

  it.each<Case>([
    ['Jane Doe 4417JD', null],
    ['PERA 4417JD', 'PERA'],
    ['PERA 12AB', 'PERA'],
    ['PERA JD4417', 'PERA'],
    ['PERA A1234B', 'PERA'],
  ])('drops an ID of digits and initials in "%s"', keeps)

  it.each<Case>([
    ['PERA 123-45-6789', 'PERA'],
    ['PERA Plan 2 SSN XXX-XX-6789', 'PERA Plan 2'],
  ])('drops a Social Security number in "%s"', keeps)
})

describe('redactPlanName keeps a real plan name whole', () => {
  it.each<Case>([
    ['PERA', 'PERA'],
    ['CalPERS', 'CalPERS'],
    ['CALPERS', 'CALPERS'],
    ['NYSTRS', 'NYSTRS'],
    ['PSERS', 'PSERS'],
    ['TIAA', 'TIAA'],
    ['TIAA CREF', 'TIAA CREF'],
    ['TIAA-CREF', 'TIAA CREF'],
    ['PERA DB', 'PERA DB'],
    ['CALSTRS DB', 'CALSTRS DB'],
    ['PERA Plan 2', 'PERA Plan 2'],
  ])('keeps a system or provider in "%s"', keeps)

  it.each<Case>([
    ['State Employees Retirement System', 'State Employees Retirement System'],
    ['STATE EMPLOYEES RETIREMENT SYSTEM', 'STATE EMPLOYEES RETIREMENT SYSTEM'],
    ['state employees retirement system', 'state employees retirement system'],
    ['Teamsters Pension Plan', 'Teamsters Pension Plan'],
    ['Teamsters Local 727 Pension Fund', 'Teamsters Local 727 Pension Fund'],
    ["Employee's Retirement Plan", "Employee's Retirement Plan"],
    ['Public Employees Retirement System of Ohio', 'Public Employees Retirement System of Ohio'],
    ['Defined Benefit Plan', 'Defined Benefit Plan'],
  ])('keeps a plan named by its words in "%s"', keeps)

  it.each<Case>([
    ['401(k) Plan', '401(k) Plan'],
    ['Fidelity 403(b)', 'Fidelity 403(b)'],
    ['Fidelity Investments 401k', 'Fidelity Investments 401k'],
    ['T. Rowe Price 401(k)', 'T. Rowe Price 401(k)'],
    ['John Hancock 401k', 'John Hancock 401k'],
    ['Vanguard 457 (b)', 'Vanguard 457 (b)'],
  ])('keeps a provider and its tax code in "%s"', keeps)

  it.each<Case>([
    ['Roth 401(k)', 'Roth 401(k)'],
    ['Employee Roth 401k', 'Employee Roth 401k'],
    ['Pre-tax 401(k)', 'Pre-tax 401(k)'],
    ['Roth IRA', 'Roth IRA'],
    ['1199SEIU Pension Fund', '1199SEIU Pension Fund'],
    ['32BJ Pension', '32BJ Pension'],
  ])('keeps an account kind and a named union local in "%s"', keeps)

  it.each<Case>([
    ['Texas TRS', 'Texas TRS'],
    ['TEXAS TRS', 'TEXAS TRS'],
    ['OHIO PERS', 'OHIO PERS'],
    ['New York State Teachers Retirement System', 'New York State Teachers Retirement System'],
    ['NY STRS', 'NY STRS'],
    ['COLORADO PERA, DENVER CO', 'COLORADO PERA'],
    ['Colorado PERA Denver CO', 'Colorado PERA'],
  ])('keeps a state that opens the name, never a place after it, in "%s"', keeps)

  it.each<Case>([
    ['PERA, DENVER', 'PERA'],
    ['CALPERS, SACRAMENTO', 'CALPERS'],
    ['NYSLRS, Albany', 'NYSLRS'],
    ['PERA Colorado', 'PERA'],
  ])('drops a city or state printed after the name in "%s"', keeps)
})

describe('redactPlanName keeps no name without a plan word', () => {
  it.each<Case>([
    ['Employee Deduction', null],
    ['State County City', null],
    ['Ohio', null],
    ['Tier 2', null],
    ['of and for', null],
  ])('keeps nothing from "%s"', keeps)

  it('stops before a word that would pass the longest name', () => {
    const name = redactPlanName(`PERA ${'Retirement '.repeat(10)}`)!
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name.endsWith('Retirement')).toBe(true)
  })
})
