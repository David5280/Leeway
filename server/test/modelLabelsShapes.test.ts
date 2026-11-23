// What a model is shown of a line Plaid gave a business's code that is still
// someone's (a longer name, a processor's seller, household pay), and of a
// row brought in from a statement file at a shop the owner buys from. Every
// name is made up.

import { describe, expect, it } from 'vitest'
import { knownShops } from '../src/domain/knownShops.js'
import { neutralLabel, type LabelSubject } from '../src/domain/modelLabels.js'

/** A line as labelling reads it: money out with no code unless a case says otherwise. */
function movement(name: string, fields: Partial<LabelSubject> = {}): LabelSubject {
  return {
    name,
    merchantName: null,
    amountCents: 2_000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    ...fields,
  }
}

/** The label a line gets, with no shops known. */
const labelOf = (name: string, fields: Partial<LabelSubject> = {}) =>
  neutralLabel(movement(name, fields))

const label = (name: string, fields: Partial<LabelSubject> = {}) => labelOf(name, fields)?.label
/** A line with the given detailed code, money out unless an amount is given. */
const coded = (code: string, fields: Partial<LabelSubject> = {}) => ({
  providerCategoryDetailed: code,
  ...fields,
})

describe("a person's name under a business's code, and a shop's imported row", () => {
  it("labels a longer person's shape, a processor's seller and household pay", () => {
    const repair = coded('HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE')
    expect(
      label('JUAN CARLOS ECHEVERRIA', { merchantName: 'Juan Carlos Echeverria', ...repair }),
    ).toBe('Purchase or payment')
    const restaurant = coded('FOOD_AND_DRINK_RESTAURANT')
    for (const name of ['SQ *J PEMBERTON', 'SQ *MAEVE ANNE CALLOWAY', 'TST* BLUE FORK', 'SP * X']) {
      expect([name, label(name, restaurant)]).toEqual([name, 'Purchase or payment'])
    }
    // A processor's seller Plaid knows as a business shows.
    expect(labelOf('SQ *BLUE BOTTLE', { ...restaurant, merchantEntityId: 'ent_bb' })).toBeNull()
    const paypal = { merchantName: 'Maria Jose Lopez', ...coded('FOOD_AND_DRINK_FAST_FOOD') }
    expect(label('PAYPAL *MARIA JOSE LOPEZ', paypal)).toBe('PayPal payment (sent)')
    const wages = coded('INCOME_WAGES', { amountCents: -90_000 })
    expect(label('DIRECT DEP JOHN Q PUBLIC HOUSEHOLD PAYROLL', wages)).toBe('Deposit')
    expect(labelOf('ACME CORP DIRECT DEP PAYROLL', wages)).toBeNull()
  })

  it('labels a name joined by a dot on a practice, or by a star on a pay line', () => {
    const practice = coded('MEDICAL_PRIMARY_CARE', { merchantEntityId: 'ent_fake_practice' })
    for (const name of ['JANE.DOE COUNSELING', 'J.OSTROWSKI COUNSELING']) {
      expect([name, label(name, { ...practice, merchantName: name })]).toEqual([
        name,
        'Medical payment',
      ])
    }
    for (const name of ['CVS', 'Walgreens', 'BetterHelp', 'BETTERHELP.COM']) {
      expect([name, labelOf(name, { ...practice, merchantName: name })]).toEqual([name, null])
    }
    // A name beside a web address, an abbreviation or an ASCII hyphen is still a person's.
    const webNames = ['Jane Doe Therapy.com', 'Ignatius Pemberton.us', 'Jane Doe Therapy.org']
    for (const name of [...webNames, 'Jane Doe, Therapy.net', 'Jane Doe St. Clinic']) {
      expect([name, label(name, { ...practice, merchantName: name })]).toEqual([
        name,
        'Medical payment',
      ])
    }
    expect(label('JANE-DOE THERAPY', { ...practice, merchantName: 'JANE-DOE THERAPY' })).toBe(
      'Medical payment',
    )
    // An abbreviation and the word after it name a place ("ACME PH.D" is a clinician's title).
    for (const name of ['ST.JOSEPH HOSPITAL', 'FT.COLLINS FAMILY MED']) {
      expect([name, labelOf(name, { ...practice, merchantName: name })]).toEqual([name, null])
    }
    const wages = coded('INCOME_WAGES', { amountCents: -90_000 })
    for (const name of ['DOE*JANE PAYROLL', 'IGNATIUS*PEMBERTON HOUSEHOLD PAYROLL']) {
      expect([name, label(name, wages)]).toEqual([name, 'Deposit'])
    }
    expect(labelOf('ACME CORP PAYROLL', wages)).toBeNull()
  })

  it('shows a row the owner typed in only as a shop they buy from, or in everyday words', () => {
    const typed = { typedOrImported: true }
    for (const name of ['Rent', 'House cleaner', 'Groceries', 'Cash']) {
      expect([name, labelOf(name, typed)]).toEqual([name, null])
    }
    // A shop is one the owner buys from only when the shops are known.
    const shops = knownShops(['King Soopers'])
    expect(neutralLabel({ ...movement('King Soopers'), ...typed }, shops)).toBeNull()
    expect(label('King Soopers', typed)).toBe('Purchase or payment')
    // Anything else could name a person, so it is labelled like a line with no code.
    expect(labelOf('Jane Doe babysitting', typed)).toEqual({
      label: 'Purchase or payment',
      kind: 'unknown',
    })
    expect(label('Rent to John Smith', typed)).toBe('Purchase or payment')
    expect(labelOf('Transfer to John Smith', typed)).toEqual({
      label: 'Payment sent',
      kind: 'transfer',
    })
    expect(label('Jane Doe', { ...typed, amountCents: -500 })).toBe('Money received')
    expect(label('Venmo Jane', typed)).toBe('Venmo payment (sent)')
    expect(label('1043', typed)).toBe('Purchase or payment')
  })

  it("shows an imported row as a known shop's whole name before everyday words", () => {
    const imported = { typedOrImported: true }
    const shops = knownShops(['Costco', 'Target'])
    const shown = (name: string) => neutralLabel({ ...movement(name), ...imported }, shops)
    // "COSTCO WHSE #0482" cleans to "Costco Warehouse".
    for (const name of ['COSTCO WHSE #0482', 'Costco Warehouse', 'TARGET 00012345']) {
      expect([name, shown(name)]).toEqual([name, null])
    }
    // Anything after the shop that could be a name, or a shop only inside a word, is labelled.
    for (const name of ['Target practice with Jane Doe', 'Costcoish Jane']) {
      expect([name, shown(name)?.label]).toEqual([name, 'Purchase or payment'])
    }
  })
})
