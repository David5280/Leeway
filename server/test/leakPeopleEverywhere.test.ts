// No private person's name reaches any output through the leak alerts: not
// list_alerts, the check-in an assistant reads, the AI summary writer's
// facts, the inbox and its stored subjects, the home screen's hides or the
// weekly email. Every probe goes in at once, beside a merchant whose rise is
// still told by name, so the alerts are really worked out.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SummaryWriter } from '../src/ai/writer.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { createOwner } from '../src/domain/owner.js'
import type { SummaryFacts, SummaryText } from '../src/domain/summaryText.js'
import type { EmailMessage, EmailSender } from '../src/mail/sender.js'
import { actionCaller } from './actionCaller.js'
import {
  APP_PEOPLE,
  DOE_TWICE,
  DRESSED_UP_NAMES,
  leaksOf,
  PERSON,
  repeat,
  SENT_TO_JANE,
  SPOTIFY,
  toldAs,
  twiceOnNov3,
  ZELLE_TO_JANE,
} from './fixtures/leakPeople.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

/**
 * Every probe, each dressed-up name on an account of its own. The finder
 * groups a series by its bank text on every account, so two probes a bank
 * would read as one name may still share one series and one alert.
 */
async function everyProbe() {
  const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })
  for (const line of [ZELLE_TO_JANE, ...SENT_TO_JANE]) await repeat(ctx.db, accountId, line)
  for (const line of SENT_TO_JANE) await twiceOnNov3(ctx.db, accountId, line)
  await repeat(ctx.db, accountId, SPOTIFY)
  for (const [index, line] of DRESSED_UP_NAMES.entries()) {
    const other = await insertBankAccount(ctx.db, {
      name: `Other ${index}`,
      mask: `${5500 + index}`,
    })
    await repeat(ctx.db, other.accountId, line)
  }
  const spare = await insertBankAccount(ctx.db, { name: 'Spare', mask: '6610' })
  await twiceOnNov3(ctx.db, spare.accountId, DOE_TWICE)
  // A person paid through an app, each charged twice on an account of its own.
  for (const [index, line] of APP_PEOPLE.entries()) {
    const app = await insertBankAccount(ctx.db, { name: `App ${index}`, mask: `${6700 + index}` })
    await twiceOnNov3(ctx.db, app.accountId, line)
  }
}

describe('a person paid every way the reviewers probed', () => {
  it('is named nowhere: alerts, check-in, AI facts, inbox and its subjects, home hides, email', async () => {
    await createOwner(ctx.db, { email: 'owner@example.com', password: 'correct horse battery' })
    await everyProbe()

    const alerts = await call('list_alerts', {})
    const told = toldAs(alerts)
    // The merchant by name, and the dressed-up names worked out too, with none.
    expect(told).toContainEqual(['Spotify went up to $11.99, from $10.99.', 'Spotify'])
    expect(told).toContainEqual(['A payment of $40 went out twice on Nov 3.', null])
    // Every app probe is really told (with no name), beside the personal care one.
    const twiceUnnamed = told.filter(
      ([message, merchant]) =>
        message === 'A payment of $40 went out twice on Nov 3.' && merchant === null,
    )
    expect(twiceUnnamed).toHaveLength(APP_PEOPLE.length + 1)
    expect(told.filter(([, merchant]) => merchant === null).length).toBeGreaterThanOrEqual(8)
    expect(told.filter(([, merchant]) => merchant !== null)).toHaveLength(1)
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
    expect(inbox.rows.filter((row) => row.subject.startsWith('rise:')).length).toBeGreaterThan(1)
    expect(JSON.stringify(inbox.rows)).not.toMatch(PERSON)

    const leaks = leaksOf(alerts)
    for (const alert of leaks) {
      await call('hide_home_alert', {
        kind: alert.kind,
        accountId: alert.accountId,
        chargeId: alert.charge!.id,
      })
    }
    const hides = await ctx.db.query('SELECT kind, subject FROM alert_hides')
    expect(hides.rows).toHaveLength(leaks.length)
    expect(JSON.stringify(hides.rows)).not.toMatch(PERSON)

    await call('send_test_weekly_email')
    expect(mailer.sent).toHaveLength(1)
    const { subject, text, html } = mailer.sent[0]!
    expect(`${subject} ${text} ${html}`).not.toMatch(PERSON)
    // Every probe is inserted and every output read, so this runs longer than most.
  }, 20_000)
})
