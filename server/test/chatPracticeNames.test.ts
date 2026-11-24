// A practice Plaid knows (MEDICAL_PRIMARY_CARE, with an entity id) whose
// merchant holds a person's name beside a web address, an abbreviation or a
// hyphen: read end to end through the tools that send merchants, it is a
// "Medical payment", while a practice named for a place or a site shows.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { useChatProbe } from './chatProbe.js'

// Merchants that name a person, each with a word that once stopped the check.
const NAMED = [
  'Jane Doe Therapy.com',
  'Ignatius Pemberton.us',
  'Jane Doe Therapy.org',
  'Jane Doe, Therapy.net',
  'Jane Doe St. Clinic',
  'JANE-DOE THERAPY',
]

// Merchants named for a site or a place, which show as written.
const SHOWN = ['BETTERHELP.COM', 'ST.JOSEPH HOSPITAL', 'FT.COLLINS FAMILY MED']

describe('a practice named for a person beside a web address or an abbreviation', () => {
  const probe = useChatProbe()

  it('is a medical payment in list_transactions and top_merchants', async () => {
    for (const [at, merchantName] of [...NAMED, ...SHOWN].entries()) {
      await probe.pay(merchantName.toUpperCase(), 2_000 + at, {
        merchantName,
        detailed: 'MEDICAL_PRIMARY_CARE',
        merchantEntityId: `ent_fake_practice_${at}`,
      })
    }
    // Shown names are cased for display ("St.joseph Hospital"), so compared in lower case.
    const lower = (names: string[]) => names.map((name) => name.toLowerCase()).sort()
    const expected = lower([...SHOWN, ...NAMED.map(() => 'Medical payment')])
    expect(lower((await probe.transactions()).map((tx) => tx.displayName))).toEqual(expected)
    // top_merchants adds up every "Medical payment" as one.
    expect(lower(await probe.merchants())).toEqual([...new Set(expected)])
    expect(
      `${await probe.sent('list_transactions')} ${await probe.sent('top_merchants')}`,
    ).not.toMatch(/jane|doe|ignatius|pemberton/i)
  }, 30_000)
})
