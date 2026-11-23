// What a model is shown of a line whose name holds a name that is also an
// everyday word ("Mark", "Brown", "King"), of a medical practice named for
// its clinician, and of the well-known shops that must still show by name.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { knownShops } from '../src/domain/knownShops.js'
import { neutralLabel, type LabelSubject } from '../src/domain/modelLabels.js'

/** A line as labelling reads it: money out, with the code and fields a case gives. */
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

/** The label a line gets with a detailed code, or null when it shows by name. */
const labelled = (name: string, code: string, fields: Partial<LabelSubject> = {}) =>
  neutralLabel(movement(name, { providerCategoryDetailed: code, ...fields }))?.label ?? null

describe('a name that is also an everyday word', () => {
  it("still makes a merchant a person's, whatever its code", () => {
    const cases: [string, string][] = [
      ['MARK OSTROWSKI', 'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE'],
      ['JANE BROWN', 'HOME_IMPROVEMENT_HARDWARE'],
      ['ODALYS KING', 'FOOD_AND_DRINK_RESTAURANT'],
      ['JUNE PARKER', 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'],
    ]
    for (const [name, code] of cases) {
      expect([name, labelled(name, code)]).toEqual([name, 'Purchase or payment'])
    }
  })

  it('names the payer of household pay, a lone surname included', () => {
    const wages = { amountCents: -90_000 }
    for (const name of [
      'DIRECT DEP MARK WHITLOCK HOUSEHOLD PAYROLL',
      'DIRECT DEP BILL WHITLOCK HOUSEHOLD PAYROLL',
    ]) {
      expect([name, labelled(name, 'INCOME_WAGES', wages)]).toEqual([name, 'Deposit'])
    }
    // An employer whose name holds such a word is still shown.
    expect(labelled('KING SOOPERS PAYROLL', 'INCOME_WAGES', wages)).toBeNull()
  })

  it('labels a row brought in from a file that holds one, even after a shop', () => {
    const shops = knownShops(['Costco'])
    for (const name of ['Mark Brown', 'Max Frank', 'Costco Will Grace']) {
      const row = movement(name, { typedOrImported: true })
      expect([name, neutralLabel(row, shops)?.label]).toEqual([name, 'Purchase or payment'])
    }
    const store = movement('Costco Warehouse', { typedOrImported: true })
    expect(neutralLabel(store, shops)).toBeNull()
  })
})

describe('a medical practice named for its clinician', () => {
  it('is a medical payment though Plaid vouches for it', () => {
    const vouched = { merchantEntityId: 'ent_fake_practice' }
    for (const name of [
      'JANE DOE COUNSELING',
      'JANE DOE PHYSICAL THERAPY',
      'JANE DOE LAC',
      'JANE DOE CNM',
      'JANE DOE, OTR/L',
    ]) {
      const label = labelled(name, 'MEDICAL_OTHER_MEDICAL', { merchantName: name, ...vouched })
      expect([name, label]).toEqual([name, 'Medical payment'])
    }
    // A practice named for no one still shows.
    const practice = { merchantName: 'Acme Physical Therapy', ...vouched }
    expect(labelled('ACME PHYSICAL THERAPY', 'MEDICAL_OTHER_MEDICAL', practice)).toBeNull()
  })
})

describe('the shops everyone buys from', () => {
  // Each with the code Plaid gives it and no word from Plaid that it is a business.
  const SHOPS: [string, string][] = [
    ['Costco', 'GENERAL_MERCHANDISE_SUPERSTORES'],
    ['Amazon', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'],
    ["Trader Joe's", 'FOOD_AND_DRINK_GROCERIES'],
    ["Ben & Jerry's", 'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK'],
    ['Netflix', 'ENTERTAINMENT_TV_AND_MOVIES'],
    ['Whole Foods', 'FOOD_AND_DRINK_GROCERIES'],
    ['Chipotle', 'FOOD_AND_DRINK_FAST_FOOD'],
    ['King Soopers', 'FOOD_AND_DRINK_GROCERIES'],
    ["Wendy's", 'FOOD_AND_DRINK_FAST_FOOD'],
    ['Target', 'GENERAL_MERCHANDISE_SUPERSTORES'],
    ['Spotify', 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    ['Shell', 'TRANSPORTATION_GAS'],
    ["Dick's Sporting Goods", 'GENERAL_MERCHANDISE_SPORTING_GOODS'],
    ['Panera Bread', 'FOOD_AND_DRINK_RESTAURANT'],
  ]

  it('show by name, from Plaid and from a file once the owner buys there', () => {
    for (const [name, code] of SHOPS) {
      expect([name, labelled(name.toUpperCase(), code, { merchantName: name })]).toEqual([
        name,
        null,
      ])
    }
    const shops = knownShops(SHOPS.map(([name]) => name))
    for (const [name] of SHOPS) {
      const row = movement(name, { typedOrImported: true })
      expect([name, neutralLabel(row, shops)]).toEqual([name, null])
    }
  })
})
