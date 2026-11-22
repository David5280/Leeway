// Leaks are about what a merchant charges. Money the owner sends a person,
// takes out as cash, writes a check for, wires or pays through the bank's bill
// pay repeats too, but its amount is the owner's choice, and a payment to a
// person is named after that person. None of it is ever a leak. A charge the
// bank cannot show a merchant made is still told, with no name. So no private
// person's name reaches an alert, and through alerts the AI summary writer,
// the check-in an assistant reads, the inbox, its stored subjects, the home
// screen's hides or the weekly email.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SummaryWriter } from '../src/ai/writer.js'
import { repeatingCharges } from '../src/domain/leaks/leakSource.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { createOwner } from '../src/domain/owner.js'
import type { SummaryFacts, SummaryText } from '../src/domain/summaryText.js'
import { untrackedSeries } from '../src/domain/untrackedRecurring.js'
import type { EmailMessage, EmailSender } from '../src/mail/sender.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

/** A stand-in for Claude that keeps every set of facts it was handed. */
class RecordingWriter implements SummaryWriter {
  readonly name = 'Claude'
  facts: SummaryFacts[] = []

  async write(facts: SummaryFacts): Promise<SummaryText> {
    this.facts.push(facts)
    return { headline: 'Written by the fake.', points: [] }
  }
}

/** A stand-in for Resend that keeps what it was given. */
class RecordingMailer implements EmailSender {
  readonly name = 'Fake'
  sent: EmailMessage[] = []

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message)
  }
}

/** The person paid in the reviewer's probes: a name no output may hold. */
const PERSON = /jane|doe/i

/** The first of each month from July, the last one at a new amount. */
const MONTHS = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']

/** One repeating line out: what the bank wrote, its codes, and the old and new amounts. */
interface Repeating {
  name: string
  merchantName?: string
  primary?: string
  detailed?: string
  /** The same text every month, or one per month (a check's number changes). */
  names?: string[]
  fromCents: number
  toCents: number
}

/** The reviewer's probe: $1,500 a month to a person by Zelle, then $1,650. */
const ZELLE_TO_JANE: Repeating = {
  name: 'Zelle payment to JANE DOE JPM99A1B2C3',
  detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
  fromCents: 150_000,
  toCents: 165_000,
}

/** Spotify at $10.99, then $11.99: a merchant's price rise, the one alert expected. */
const SPOTIFY: Repeating = {
  name: 'SPOTIFY USA',
  merchantName: 'Spotify',
  fromCents: 1_099,
  toCents: 1_199,
}

/** $1,500 a month, then $1,650: the reviewer's amounts for a payment to a person. */
const RENT = { fromCents: 150_000, toCents: 165_000 }

/**
 * The reviewer's probes: what banks write for money sent to a person by bill
 * pay, wire, check or a payment app, with none of the bank's codes, and once
 * coded as rent.
 */
const SENT_TO_JANE: Repeating[] = [
  { name: 'ONLINE PAYMENT TO JANE DOE', ...RENT },
  {
    name: 'ONLINE PAYMENT TO JANE DOE',
    primary: 'RENT_AND_UTILITIES',
    detailed: 'RENT_AND_UTILITIES_RENT',
    ...RENT,
  },
  { name: 'BILL PAY JANE DOE', ...RENT },
  { name: 'ACH DEBIT JANE DOE', ...RENT },
  { name: 'WIRE TO JANE DOE', ...RENT },
  { name: 'CHECK JANE DOE', ...RENT },
  { name: 'GOOGLE PAY SEND JANE DOE', ...RENT },
  { name: 'ZEL*JANE DOE', ...RENT },
  { name: 'SQC*JANE DOE', ...RENT },
]

/** Every kind of repeating line out a merchant did not charge. */
const NOT_MERCHANTS: Repeating[] = [
  ZELLE_TO_JANE,
  ...SENT_TO_JANE,
  {
    name: 'VENMO PAYMENT TO SAM RIVER',
    detailed: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
    fromCents: 5_000,
    toCents: 6_000,
  },
  { name: 'CASH APP*ALEX STONE', primary: 'TRANSFER_OUT', fromCents: 4_000, toCents: 5_000 },
  { name: 'PAYPAL TRANSFER TO CHRIS LAKE', fromCents: 2_500, toCents: 3_000 },
  { name: 'ATM WITHDRAWAL MAIN ST', fromCents: 20_000, toCents: 30_000 },
  {
    name: 'CHECK 1041',
    names: ['CHECK 1041', 'CHECK 1042', 'CHECK 1043', 'CHECK 1044', 'CHECK 1045'],
    fromCents: 120_000,
    toCents: 130_000,
  },
  {
    name: 'ONLINE TRANSFER TO SAV',
    detailed: 'TRANSFER_OUT_SAVINGS',
    fromCents: 10_000,
    toCents: 20_000,
  },
]

const writer = new RecordingWriter()
const mailer = new RecordingMailer()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ writer, mailer })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  writer.facts = []
  mailer.sent = []
})

/** Inserts one repeating line on the account, monthly from July, at its new amount in November. */
async function repeat(accountId: string, line: Repeating) {
  for (const [month, date] of MONTHS.entries()) {
    await insertBankTransaction(ctx.db, accountId, {
      date,
      name: line.names?.[month] ?? line.name,
      merchantName: line.merchantName ?? null,
      primary: line.primary ?? null,
      detailed: line.detailed ?? null,
      amountCents: date === MONTHS.at(-1) ? line.toCents : line.fromCents,
    })
  }
}

/** Inserts one line twice on Nov 3, $40 each: the reviewer's probe for a charge made twice. */
async function twiceOnNov3(accountId: string, line: Repeating) {
  for (let time = 0; time < 2; time++) {
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-03',
      name: line.name,
      merchantName: line.merchantName ?? null,
      primary: line.primary ?? null,
      detailed: line.detailed ?? null,
      amountCents: 4_000,
    })
  }
}

const leaks = async () =>
  (await call('list_alerts', {})).filter(
    (alert) => alert.kind === 'price_rise' || alert.kind === 'duplicate_charge',
  )

const priceRises = async () => (await leaks()).filter((alert) => alert.kind === 'price_rise')

/** Each leak's sentence, and the merchant it names (null for none). */
const toldAs = async () =>
  (await leaks()).map((alert) => [alert.message, alert.charge?.merchant ?? null])

const everyday = () => insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })

describe('repeating lines a merchant did not charge', () => {
  it('are found as repeating, yet only the merchant is read for a price rise', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    for (const line of [...NOT_MERCHANTS, SPOTIFY]) await repeat(accountId, line)

    // Detection still finds them (so they can be tracked as bills), which is
    // what makes this a real test of the rise check rather than of detection.
    const found = await untrackedSeries(ctx.db, '2026-11-17')
    expect(found.length).toBeGreaterThanOrEqual(NOT_MERCHANTS.length)
    const merchants = repeatingCharges(found).map((one) => one.charges[0]!.merchantName)
    expect(merchants).toEqual(['Spotify'])
  })

  it('never raise a price rise: the reviewer’s Zelle probe included', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    await repeat(accountId, ZELLE_TO_JANE)
    expect(await priceRises()).toEqual([])
  })

  it.each(NOT_MERCHANTS.map((line) => [line.name, line] as const))(
    'raise none for %s',
    async (_name, line) => {
      const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
      await repeat(accountId, line)
      expect(await priceRises()).toEqual([])
    },
  )

  it.each(SENT_TO_JANE.map((line) => [line.name, line.detailed ?? 'no code', line] as const))(
    'raise no charge made twice for %s (%s), $40 twice in one day',
    async (_name, _code, line) => {
      const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
      await twiceOnNov3(accountId, line)
      expect(await leaks()).toEqual([])
    },
  )

  it('leave out a whole series when any of its lines is a payment to a person', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    await repeat(accountId, SPOTIFY)
    // The bank coded one month's line as sent through an app: the series is not a price.
    await ctx.db.query(
      `UPDATE transactions SET provider_category_detailed = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'
       WHERE date = '2026-09-01'`,
    )
    expect(await priceRises()).toEqual([])
  })
})

describe('a charge no merchant is known to have made', () => {
  it('is told with no name when coded as rent, still opening its charges', async () => {
    const { accountId } = await everyday()
    await repeat(accountId, {
      name: 'JANE DOE',
      primary: 'RENT_AND_UTILITIES',
      detailed: 'RENT_AND_UTILITIES_RENT',
      ...RENT,
    })
    const [rise] = await leaks()
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

  it('is told with no name when the bank gave no merchant and no code', async () => {
    const { accountId } = await everyday()
    await twiceOnNov3(accountId, { name: 'JANE DOE', fromCents: 0, toCents: 0 })
    expect(await toldAs()).toEqual([['A payment of $40 went out twice on Nov 3.', null]])
  })

  it('is told with no name when paid through a payment app, though coded as a purchase', async () => {
    const { accountId } = await everyday()
    await repeat(accountId, {
      name: 'PAYPAL *JANEDOE',
      primary: 'GENERAL_MERCHANDISE',
      detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
      fromCents: 10_000,
      toCents: 12_000,
    })
    expect(await toldAs()).toEqual([['A repeating payment went up to $120, from $100.', null]])
  })

  it('is told with no name when the merchant the bank gave reads as a person', async () => {
    const { accountId } = await everyday()
    await repeat(accountId, {
      name: 'JANE DOE',
      merchantName: 'Jane Doe',
      primary: 'GENERAL_SERVICES',
      detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      fromCents: 10_000,
      toCents: 12_000,
    })
    expect(await toldAs()).toEqual([['A repeating payment went up to $120, from $100.', null]])
  })
})

describe('a merchant the bank names', () => {
  it.each([
    ['Netflix', { name: 'NETFLIX.COM', merchantName: 'Netflix', fromCents: 1_549, toCents: 1_799 }],
    ['Spotify', SPOTIFY],
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
  ] as const)('is still named when its price goes up: %s', async (merchant, line) => {
    const { accountId } = await everyday()
    await repeat(accountId, line)
    const [rise] = await priceRises()
    expect(rise!.message).toMatch(new RegExp(`^${merchant} went up to `))
    expect(rise!.charge!.merchant).toBe(merchant)
  })

  it('is still named when a quarterly price goes up: GEICO', async () => {
    const { accountId } = await everyday()
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
    expect(await toldAs()).toEqual([['Geico went up to $330, from $300.', 'Geico']])
  })

  it('is still named when it charges twice: Amazon', async () => {
    const { accountId } = await everyday()
    await twiceOnNov3(accountId, {
      name: 'AMAZON.COM*AB12CD',
      merchantName: 'Amazon',
      primary: 'GENERAL_MERCHANDISE',
      fromCents: 0,
      toCents: 0,
    })
    expect(await toldAs()).toEqual([['Amazon charged $40 twice on Nov 3.', 'Amazon']])
  })
})

describe('a person paid every way the reviewer probed', () => {
  /**
   * Every probe. The finder groups a series by its bank text on every
   * account, so each line here has text of its own.
   */
  async function everyProbe() {
    const { accountId } = await everyday()
    for (const line of [ZELLE_TO_JANE, ...SENT_TO_JANE]) await repeat(accountId, line)
    for (const line of SENT_TO_JANE) await twiceOnNov3(accountId, line)
    await repeat(accountId, SPOTIFY)
    const rent = await insertBankAccount(ctx.db, { name: 'Rent', mask: '5521' })
    await repeat(rent.accountId, {
      name: 'JANE DOE RENT',
      primary: 'RENT_AND_UTILITIES',
      detailed: 'RENT_AND_UTILITIES_RENT',
      ...RENT,
    })
    const card = await insertBankAccount(ctx.db, { name: 'Card', type: 'credit', mask: '7730' })
    await repeat(card.accountId, {
      name: 'PAYPAL *JANEDOE',
      primary: 'GENERAL_MERCHANDISE',
      fromCents: 10_000,
      toCents: 12_000,
    })
    const spare = await insertBankAccount(ctx.db, { name: 'Spare', mask: '6610' })
    await twiceOnNov3(spare.accountId, { name: 'DOE JANE', fromCents: 0, toCents: 0 })
    const services = await insertBankAccount(ctx.db, { name: 'Services', mask: '8840' })
    await repeat(services.accountId, {
      name: 'JANE M DOE',
      merchantName: 'Jane Doe',
      primary: 'GENERAL_SERVICES',
      fromCents: 10_000,
      toCents: 12_000,
    })
  }

  it('is named nowhere: alerts, check-in, AI facts, inbox and its subjects, home hides, email', async () => {
    await createOwner(ctx.db, { email: 'owner@example.com', password: 'correct horse battery' })
    await everyProbe()

    const alerts = await call('list_alerts', {})
    // The leaks were really worked out: the merchant by name, the rest with none.
    expect((await toldAs()).sort()).toEqual(
      [
        ['A payment of $40 went out twice on Nov 3.', null],
        ['A repeating payment went up to $1,650, from $1,500.', null],
        ['A repeating payment went up to $120, from $100.', null],
        ['A repeating payment went up to $120, from $100.', null],
        ['Spotify went up to $11.99, from $10.99.', 'Spotify'],
      ].sort(),
    )
    expect(JSON.stringify(alerts)).not.toMatch(PERSON)

    expect(JSON.stringify(await call('get_checkin'))).not.toMatch(PERSON)

    await call('set_ai_summary', { on: true })
    await call('get_summary')
    expect(writer.facts).toHaveLength(1)
    expect(writer.facts[0]!.accountAlerts).toContain('Spotify went up to $11.99, from $10.99.')
    expect(JSON.stringify(writer.facts)).not.toMatch(PERSON)

    await refreshInbox(ctx)
    const inbox = await ctx.db.query<{ subject: string }>(
      'SELECT kind, subject, title, message, push_body FROM notifications',
    )
    expect(inbox.rows.filter((row) => row.subject.startsWith('rise:'))).toHaveLength(4)
    expect(JSON.stringify(inbox.rows)).not.toMatch(PERSON)

    for (const alert of await leaks()) {
      await call('hide_home_alert', {
        kind: alert.kind,
        accountId: alert.accountId,
        chargeId: alert.charge!.id,
      })
    }
    const hides = await ctx.db.query('SELECT kind, subject FROM alert_hides')
    expect(hides.rows).toHaveLength(5)
    expect(JSON.stringify(hides.rows)).not.toMatch(PERSON)

    await call('send_test_weekly_email')
    expect(mailer.sent).toHaveLength(1)
    const { subject, text, html } = mailer.sent[0]!
    expect(`${subject} ${text} ${html}`).not.toMatch(PERSON)
  })
})
