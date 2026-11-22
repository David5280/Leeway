// How a leak a merchant may have made is named (leaks/leakNames.ts): by the
// merchant, from the bank's merchant name or its text alone (as a hand-entered
// or imported line has), unless it is rent, a payment app line with no
// merchant named, or a name that reads as a person's however a bank dresses
// it up (on a payment app's line, even one the bank coded as a store). Those
// are told with no name, still opening their charges.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { actionCaller } from './actionCaller.js'
import {
  APP_PEOPLE,
  DOE_TWICE,
  DRESSED_UP_NAMES,
  leaksOf,
  MONTHS,
  PERSON,
  RENT,
  repeat,
  SPOTIFY,
  toldAs,
  twiceOnNov3,
  type Repeating,
} from './fixtures/leakPeople.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
})

const alerts = () => call('list_alerts', {})

const everyday = async () =>
  (await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })).accountId

describe('a leak whose name may be a person’s', () => {
  it('rising with no codes reads as a repeating payment, still opening its charges', async () => {
    await repeat(ctx.db, await everyday(), { name: 'JANE DOE', ...RENT })
    const [rise] = leaksOf(await alerts())
    expect(rise).toMatchObject({
      kind: 'price_rise',
      message: 'A repeating payment went up to $1,650, from $1,500.',
      charge: { merchant: null, previousCents: 150_000 },
    })
    // The charge it opens is the November payment itself.
    const { rows } = await ctx.db.query<{ date: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM transactions WHERE id = $1`,
      [rise!.charge!.id],
    )
    expect(rows).toEqual([{ date: '2026-11-01' }])
  })

  it.each(DRESSED_UP_NAMES.map((line) => [line.merchantName ?? line.name, line] as const))(
    'is told, with no name: %s',
    async (_name, line) => {
      await repeat(ctx.db, await everyday(), line)
      const told = toldAs(await alerts())
      expect(told).toHaveLength(1)
      expect(told[0]![1]).toBeNull()
      expect(JSON.stringify(await alerts())).not.toMatch(PERSON)
    },
  )

  it('charged twice in a day as personal care, is told with no name', async () => {
    await twiceOnNov3(ctx.db, await everyday(), DOE_TWICE)
    expect(toldAs(await alerts())).toEqual([['A payment of $40 went out twice on Nov 3.', null]])
  })

  it.each(APP_PEOPLE.map((line) => [line.name, line.primary, line] as const))(
    'paid through an app as %s (%s), named by the bank as the merchant, is told with no name',
    async (_name, _code, line) => {
      await twiceOnNov3(ctx.db, await everyday(), line)
      expect(toldAs(await alerts())).toEqual([['A payment of $40 went out twice on Nov 3.', null]])
    },
  )

  it('entered by hand each month, with words between the names, is told with no name', async () => {
    const babysitting = await call('create_account', {
      name: 'Wallet',
      type: 'depository',
      balanceCents: 400_000,
    })
    for (const date of MONTHS) {
      await call('create_transaction', {
        accountId: babysitting.id,
        date,
        name: 'Jane Doe for babysitting',
        amountCents: date === MONTHS.at(-1) ? 45_000 : 40_000,
      })
    }
    expect(toldAs(await alerts())).toEqual([
      ['A repeating payment went up to $450, from $400.', null],
    ])
  })
})

describe('a merchant', () => {
  it.each([
    ['Netflix', { name: 'NETFLIX.COM', merchantName: 'Netflix', fromCents: 1_549, toCents: 1_799 }],
    ['Spotify', SPOTIFY],
    ['Streamly', { name: 'Streamly', fromCents: 1_099, toCents: 1_199 }],
    [
      'Planet Fitness',
      {
        name: 'PLANET FITNESS #123',
        merchantName: 'Planet Fitness',
        fromCents: 2_499,
        toCents: 2_999,
      },
    ],
    [
      'Wise',
      {
        name: 'TRANSFERWISE INC',
        merchantName: 'Wise',
        primary: 'GENERAL_SERVICES',
        fromCents: 900,
        toCents: 1_200,
      },
    ],
    [
      'Comcast',
      {
        name: 'ONLINE PAYMENT TO COMCAST',
        merchantName: 'Comcast',
        primary: 'RENT_AND_UTILITIES',
        detailed: 'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
        fromCents: 8_000,
        toCents: 9_500,
      },
    ],
    [
      'State Farm',
      {
        name: 'STATE FARM INSURANCE',
        merchantName: 'State Farm',
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_INSURANCE',
        fromCents: 12_000,
        toCents: 13_500,
      },
    ],
  ] as [string, Repeating][])(
    'is still named when its price goes up: %s',
    async (merchant, line) => {
      await repeat(ctx.db, await everyday(), line)
      const [rise] = leaksOf(await alerts())
      expect(rise!.message).toMatch(new RegExp(`^${merchant} went up to `))
      expect(rise!.charge!.merchant).toBe(merchant)
    },
  )

  it('is still named when a quarterly price goes up: GEICO', async () => {
    const accountId = await everyday()
    for (const [date, amountCents] of [
      ['2026-02-10', 30_000],
      ['2026-05-10', 30_000],
      ['2026-08-10', 30_000],
      ['2026-11-10', 33_000],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'GEICO *AUTO',
        merchantName: 'Geico',
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_INSURANCE',
        amountCents,
      })
    }
    expect(toldAs(await alerts())).toEqual([['Geico went up to $330, from $300.', 'Geico']])
  })

  it.each([
    [
      'Amazon',
      { name: 'AMAZON.COM*AB12CD', merchantName: 'Amazon', primary: 'GENERAL_MERCHANDISE' },
    ],
    ['Taco Bell', { name: 'TACO BELL 031', merchantName: 'Taco Bell', primary: 'FOOD_AND_DRINK' }],
    ['Corner Hardware', { name: 'Corner Hardware' }],
    // A real merchant paid through PayPal, which the bank named.
    ['Spotify', { name: 'PAYPAL *SPOTIFY', merchantName: 'Spotify', primary: 'ENTERTAINMENT' }],
    // Lines imported from a CSV: no merchant name and no codes.
    ['Taco Bell', { name: 'TACO BELL #031' }],
    ['Spotify USA', { name: 'SPOTIFY USA' }],
    ['Bank of America', { name: 'BANK OF AMERICA' }],
    ['The Home Depot', { name: 'THE HOME DEPOT #123' }],
  ] as const)('is still named when it charges twice: %s, as %o', async (merchant, fields) => {
    await twiceOnNov3(ctx.db, await everyday(), { ...fields, fromCents: 0, toCents: 0 })
    expect(toldAs(await alerts())).toEqual([[`${merchant} charged $40 twice on Nov 3.`, merchant]])
  })
})
