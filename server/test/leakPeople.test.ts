// Price rises are about what a merchant charges. Money the owner sends a
// person, takes out as cash, writes a check for or moves to another account
// repeats too, but its amount is the owner's choice, and a payment to a
// person is named after that person. None of it is ever a price rise, so no
// private person's name reaches an alert, and through alerts the AI summary
// writer, the check-in an assistant reads, the inbox or the weekly email.

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

/** The person paid by Zelle in the reviewer's probe: a name no output may hold. */
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

/** Every kind of repeating line out a merchant did not charge. */
const NOT_MERCHANTS: Repeating[] = [
  ZELLE_TO_JANE,
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

const priceRises = async () =>
  (await call('list_alerts', {})).filter((alert) => alert.kind === 'price_rise')

describe('repeating lines a merchant did not charge', () => {
  it('are found as repeating, yet only the merchant is read for a price rise', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    for (const line of [...NOT_MERCHANTS, SPOTIFY]) await repeat(accountId, line)

    // Detection still finds them (so they can be tracked as bills), which is
    // what makes this a real test of the rise check rather than of detection.
    const found = await untrackedSeries(ctx.db, '2026-11-17')
    expect(found.length).toBeGreaterThanOrEqual(NOT_MERCHANTS.length)
    expect(repeatingCharges(found).map((one) => one.name)).toEqual(['Spotify'])
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

describe('a person paid by Zelle', () => {
  it('is named nowhere: not in alerts, the check-in, the AI facts, the inbox or the email', async () => {
    await createOwner(ctx.db, { email: 'owner@example.com', password: 'correct horse battery' })
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })
    await repeat(accountId, ZELLE_TO_JANE)
    await repeat(accountId, SPOTIFY)

    const alerts = await call('list_alerts', {})
    // The merchant's rise still shows, so the alerts were really worked out.
    expect(alerts.map((alert) => alert.message)).toContain(
      'Spotify went up to $11.99, from $10.99.',
    )
    expect(JSON.stringify(alerts)).not.toMatch(PERSON)

    expect(JSON.stringify(await call('get_checkin'))).not.toMatch(PERSON)

    await call('set_ai_summary', { on: true })
    await call('get_summary')
    expect(writer.facts).toHaveLength(1)
    expect(writer.facts[0]!.accountAlerts).toContain('Spotify went up to $11.99, from $10.99.')
    expect(JSON.stringify(writer.facts)).not.toMatch(PERSON)

    await refreshInbox(ctx)
    const inbox = await ctx.db.query<{ message: string; push_body: string }>(
      'SELECT message, push_body FROM notifications',
    )
    expect(inbox.rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(inbox.rows)).not.toMatch(PERSON)

    await call('send_test_weekly_email')
    expect(mailer.sent).toHaveLength(1)
    const { subject, text, html } = mailer.sent[0]!
    expect(`${subject} ${text} ${html}`).not.toMatch(PERSON)
  })
})
