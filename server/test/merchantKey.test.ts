// Whether two charges read as the same merchant, as a pending charge set
// aside and the charge it became are paired (heldCharges.ts). Pure.

import { describe, expect, it } from 'vitest'
import { sameMerchant } from '../src/domain/merchantKey.js'

const named = (name: string, merchantName: string | null = null) => ({ name, merchantName })

describe('sameMerchant', () => {
  it('matches on the first word of the merchant names', () => {
    expect(
      sameMerchant(named('BEST BUY 00012', 'Best Buy'), named('Best Buy', 'Best Buy Co')),
    ).toBe(true)
    expect(
      sameMerchant(named('THE HOME DEPOT', 'The Home Depot'), named('HOME DEPOT', 'Home Depot')),
    ).toBe(true)
  })

  it('lets the merchant names decide when the bank gave both', () => {
    expect(sameMerchant(named('PP*NETFLIX', 'Netflix'), named('PP*SPOTIFY', 'Spotify'))).toBe(false)
    expect(
      sameMerchant(
        named('VISA PURCHASE SHELL', 'Shell'),
        named('VISA PURCHASE SAFEWAY', 'Safeway'),
      ),
    ).toBe(false)
  })

  it('matches on the text when a merchant name is missing', () => {
    expect(sameMerchant(named('SHELL OIL 5741'), named('Shell'))).toBe(true)
    expect(sameMerchant(named('SHELL OIL 5741'), named('Shell Oil', 'Shell'))).toBe(true)
    expect(sameMerchant(named('Shell'), named('Safeway'))).toBe(false)
  })

  it('reads past processor codes and card wording', () => {
    expect(sameMerchant(named('POS PURCHASE SHELL'), named('Shell'))).toBe(true)
    expect(sameMerchant(named('PAYPAL *NETFLIX'), named('Netflix.com'))).toBe(true)
    expect(sameMerchant(named('SQ *BLUE BOTTLE'), named('SQ *CORNER BAKERY'))).toBe(false)
    expect(sameMerchant(named('POS WITHDRAWAL SHELL'), named('POS WITHDRAWAL SAFEWAY'))).toBe(false)
  })

  it('never matches text with no readable name in it', () => {
    expect(sameMerchant(named('#1234'), named('#5678'))).toBe(false)
    expect(sameMerchant(named('#1234', '#1234'), named('#5678', '#5678'))).toBe(false)
  })
})
