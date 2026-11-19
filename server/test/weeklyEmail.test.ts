import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { createOwner } from '../src/domain/owner.js'
import { createToken } from '../src/domain/tokens.js'
import { sendWeeklyEmailIfDue, TEST_COOLDOWN_SECONDS } from '../src/domain/weeklyEmail/send.js'
import { RETRY_AFTER_MINUTES } from '../src/domain/weeklyEmail/schedule.js'
import { buildApp } from '../src/http/app.js'
import { MailError, type EmailMessage, type EmailSender } from '../src/mail/sender.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

/** A stand-in for Resend that keeps what it was given and can be made to fail. */
class FakeMailer implements EmailSender {
  readonly name = 'Fake'
  sent: EmailMessage[] = []
  failWith: string | null = null

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw new MailError(this.failWith)
    this.sent.push(message)
  }
}

const OWNER = 'owner@example.com'
const WEEKLY_ACTIONS = ['get_weekly_email', 'set_weekly_email', 'send_test_weekly_email']
/** Nov 18, 2026 is a Wednesday; Nov 23 a Monday. Denver is UTC-7 in November. */
const WEDNESDAY = new Date('2026-11-18T17:00:00Z')
const MONDAY_8AM_DENVER = new Date('2026-11-23T15:00:00Z')

const mailer = new FakeMailer()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)

beforeAll(async () => {
  ctx = await createTestContext({ now: WEDNESDAY, mailer })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await createOwner(ctx.db, { email: OWNER, password: 'correct horse battery' })
  await call('update_settings', { timeZone: 'America/Denver' })
  ctx.setNow(WEDNESDAY)
  ctx.mailer = mailer
  mailer.sent = []
  mailer.failWith = null
})

/** Turns the email on for Mondays at 8 AM, on Wednesday. */
const turnOnForMondays = () => call('set_weekly_email', { on: true, weekday: 1, hour: 8 })

describe('get_weekly_email and set_weekly_email', () => {
  it('starts off, going to the sign-in email on Mondays at 8 AM', async () => {
    expect(await call('get_weekly_email')).toEqual({
      available: true,
      on: false,
      sendTo: null,
      ownerEmail: OWNER,
      weekday: 1,
      hour: 8,
      timeZone: 'America/Denver',
      nextSendAt: null,
      lastSentAt: null,
      lastError: null,
      linksTo: null,
    })
  })

  it('turns it on and says when the first email goes', async () => {
    const view = await call('set_weekly_email', { on: true, weekday: 5, hour: 17 })
    expect(view).toMatchObject({ on: true, weekday: 5, hour: 17 })
    // Friday Nov 20 at 5 PM in Denver.
    expect(view.nextSendAt).toBe('2026-11-21T00:00:00.000Z')
  })

  it('changes only what it is given, and keeps a tidy address', async () => {
    await call('set_weekly_email', { sendTo: '  Me@Example.COM ' })
    await call('set_weekly_email', { hour: 6 })
    expect(await call('get_weekly_email')).toMatchObject({
      sendTo: 'me@example.com',
      hour: 6,
      weekday: 1,
      on: false,
    })
    expect((await call('set_weekly_email', { sendTo: '' })).sendTo).toBeNull()
    await call('set_weekly_email', { sendTo: 'me@example.com' })
    expect((await call('set_weekly_email', { sendTo: null })).sendTo).toBeNull()
  })

  it('refuses an address that is not one, a day or hour out of range, and unknown fields', async () => {
    expect((await callError('set_weekly_email', { sendTo: 'not an email' })).message).toMatch(
      /valid email address/,
    )
    expect((await callError('set_weekly_email', { weekday: 7 })).code).toBe('invalid_input')
    expect((await callError('set_weekly_email', { hour: 24 })).code).toBe('invalid_input')
    expect((await callError('set_weekly_email', { from: 'x@example.com' })).code).toBe(
      'invalid_input',
    )
  })

  it('says it is unavailable, and will not turn on, until the server can send email', async () => {
    ctx.mailer = null
    expect((await call('get_weekly_email')).available).toBe(false)
    const error = await callError('set_weekly_email', { on: true })
    expect(error.code).toBe('not_configured')
    expect(error.message).toMatch(/RESEND_API_KEY and MAIL_FROM/)
    // The other choices can still be made ahead of time.
    expect((await call('set_weekly_email', { hour: 7 })).hour).toBe(7)
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('unavailable')
  })

  it('shows the address the email links to', async () => {
    const config = ctx.config
    ctx.config = { ...config, publicUrl: 'https://leeway.example.com' }
    try {
      expect((await call('get_weekly_email')).linksTo).toBe('https://leeway.example.com')
    } finally {
      ctx.config = config
    }
  })
})

describe('who controls it', () => {
  it('is the owner in the app only, never an assistant', () => {
    for (const name of WEEKLY_ACTIONS) {
      expect(findAction(name)).toMatchObject({ surface: 'app' })
    }
    const agentNames = agentTools('write').map((tool) => tool.name)
    for (const name of WEEKLY_ACTIONS) expect(agentNames).not.toContain(name)
  })

  it('refuses an assistant that calls it over MCP, even with write access', async () => {
    const app = await buildApp(ctx, { webDir: null })
    try {
      const { token } = await createToken(ctx.db, 'Coach', 'write')
      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'set_weekly_email', arguments: { sendTo: 'attacker@example.com' } },
        },
      })
      expect(response.json().result).toMatchObject({ isError: true })
      expect((await call('get_weekly_email')).sendTo).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('cannot be changed through update_settings or a settings import, nor read from settings', async () => {
    await call('set_weekly_email', { sendTo: 'me@example.com' })
    for (const field of ['weeklyEmail', 'sendTo', 'on']) {
      expect((await callError('update_settings', { [field]: true })).code).toBe('invalid_input')
    }
    const config = {
      app: 'leeway',
      version: 1,
      settings: { weeklyEmail: { on: true, sendTo: 'attacker@example.com' } },
    }
    await call('import_config', { config, mode: 'merge' })
    expect(await call('get_weekly_email')).toMatchObject({ on: false, sendTo: 'me@example.com' })
    expect(JSON.stringify(await call('get_settings'))).not.toContain('me@example.com')
    expect(JSON.stringify(await call('export_config'))).not.toContain('me@example.com')
  })
})

describe('sending on schedule', () => {
  it('waits for the chosen day and hour in the owner’s time zone, then sends once', async () => {
    await turnOnForMondays()
    // Wednesday's turn-on does not send for the Monday already past.
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, -1))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')

    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, 4))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({
      to: OWNER,
      subject: 'Your week in Leeway: $0 spent',
    })
    expect(mailer.sent[0]!.text).toContain('Nothing needs you right now.')
    expect(mailer.sent[0]!.html).toContain('<!doctype html>')

    expect(await call('get_weekly_email')).toMatchObject({
      lastSentAt: minutesAfter(MONDAY_8AM_DENVER, 4).toISOString(),
      nextSendAt: '2026-11-30T15:00:00.000Z',
      lastError: null,
    })
  })

  it('sends to the chosen address, with a link to Leeway when its address is known', async () => {
    await call('set_weekly_email', { on: true, sendTo: 'me@example.com' })
    const config = ctx.config
    ctx.config = { ...config, publicUrl: 'https://leeway.example.com' }
    try {
      ctx.setNow(MONDAY_8AM_DENVER)
      expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')
    } finally {
      ctx.config = config
    }
    expect(mailer.sent[0]!.to).toBe('me@example.com')
    expect(mailer.sent[0]!.text).toContain('Open Leeway: https://leeway.example.com')
  })

  it('takes a new day or hour from the next chosen time, and a new address at once', async () => {
    await turnOnForMondays()
    // At 7:30 on Monday the owner moves it to 7 AM: today's 7 AM has passed, so next week.
    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, -30))
    await call('set_weekly_email', { hour: 7 })
    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, 60))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    ctx.setNow(new Date('2026-11-30T14:00:00Z'))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')

    // A new address keeps the schedule: a send already due still goes, to the new address.
    ctx.setNow(new Date('2026-12-07T16:00:00Z'))
    await call('set_weekly_email', { sendTo: 'me@example.com' })
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')
    expect(mailer.sent.map((message) => message.to)).toEqual([OWNER, 'me@example.com'])
  })

  it('sends nothing while off', async () => {
    ctx.setNow(MONDAY_8AM_DENVER)
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    await turnOnForMondays()
    await call('set_weekly_email', { on: false })
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    expect(mailer.sent).toEqual([])
  })

  it('catches up once on a week the server slept through', async () => {
    await turnOnForMondays()
    // Asleep from Wednesday until the Saturday after Monday's email was due.
    ctx.setNow(new Date('2026-11-28T18:00:00Z'))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')
    ctx.setNow(new Date('2026-11-29T18:00:00Z'))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    expect(mailer.sent).toHaveLength(1)
  })

  it('sends once when two servers check at the same moment', async () => {
    await turnOnForMondays()
    ctx.setNow(MONDAY_8AM_DENVER)
    const outcomes = await Promise.all([sendWeeklyEmailIfDue(ctx), sendWeeklyEmailIfDue(ctx)])
    expect(outcomes.filter((outcome) => outcome === 'sent')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome !== 'sent')[0]).toMatch(
      /^(claimed_elsewhere|not_due)$/,
    )
    expect(mailer.sent).toHaveLength(1)
  })

  it('records a failure for the app, retries an hour later, and clears it once sent', async () => {
    await turnOnForMondays()
    ctx.setNow(MONDAY_8AM_DENVER)
    mailer.failWith = 'Resend refused the email (403): The domain is not verified.'
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('failed')
    expect(await call('get_weekly_email')).toMatchObject({
      lastSentAt: null,
      lastError: {
        message: 'Resend refused the email (403): The domain is not verified.',
        at: MONDAY_8AM_DENVER.toISOString(),
      },
      nextSendAt: minutesAfter(MONDAY_8AM_DENVER, RETRY_AFTER_MINUTES).toISOString(),
    })

    mailer.failWith = null
    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, 30))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('not_due')
    ctx.setNow(minutesAfter(MONDAY_8AM_DENVER, RETRY_AFTER_MINUTES))
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('sent')
    expect((await call('get_weekly_email')).lastError).toBeNull()
  })

  it('keeps a failure’s message short', async () => {
    await turnOnForMondays()
    ctx.setNow(MONDAY_8AM_DENVER)
    mailer.failWith = 'x'.repeat(2000)
    await sendWeeklyEmailIfDue(ctx)
    expect((await call('get_weekly_email')).lastError!.message).toHaveLength(500)
  })

  it('records whatever a sender throws, even when it is not an Error', async () => {
    await turnOnForMondays()
    ctx.setNow(MONDAY_8AM_DENVER)
    ctx.mailer = { name: 'Odd', send: () => Promise.reject('connection reset') }
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('failed')
    expect((await call('get_weekly_email')).lastError!.message).toBe('connection reset')
  })

  it('records a failure when there is no one to send to', async () => {
    await turnOnForMondays()
    await ctx.db.query('DELETE FROM owner')
    ctx.setNow(MONDAY_8AM_DENVER)
    expect(await sendWeeklyEmailIfDue(ctx)).toBe('failed')
    expect((await call('get_weekly_email')).lastError!.message).toBe(
      'There is no address to send the email to',
    )
  })
})

describe('send_test_weekly_email', () => {
  it('sends the email now, marked as a test, without touching the schedule', async () => {
    expect(await call('send_test_weekly_email')).toEqual({ sentTo: OWNER })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.subject).toBe('Test: Your week in Leeway: $0 spent')
    expect(await call('get_weekly_email')).toMatchObject({ on: false, lastSentAt: null })
  })

  it('names an account in an alert as the app does', async () => {
    await insertBankAccount(ctx.db, { name: 'TOTAL CHECKING', balanceCents: -4210 })
    const [alert] = await call('list_alerts')
    await call('send_test_weekly_email')
    expect(alert!.accountName).toBe('Test Total Checking')
    expect(mailer.sent[0]!.text).toContain('Test Total Checking is overdrawn by $42.10.')
    expect(mailer.sent[0]!.html).toContain('Test Total Checking is overdrawn by $42.10.')
  })

  it('never puts an account number in the email, even one in the bank name', async () => {
    await insertBankAccount(ctx.db, {
      name: 'CREDIT CARD (X4417)',
      mask: '4417',
      type: 'depository',
      balanceCents: -4210,
    })
    await call('send_test_weekly_email')
    const [email] = mailer.sent
    expect(email!.text).toContain('Test Credit Card is overdrawn by $42.10.')
    expect(`${email!.subject} ${email!.text} ${email!.html}`).not.toContain('4417')
  })

  it('goes to the chosen address', async () => {
    await call('set_weekly_email', { sendTo: 'me@example.com' })
    expect(await call('send_test_weekly_email')).toEqual({ sentTo: 'me@example.com' })
  })

  it('waits half a minute between tests', async () => {
    await call('send_test_weekly_email')
    const error = await callError('send_test_weekly_email')
    expect(error.code).toBe('conflict')
    ctx.setNow(new Date(WEDNESDAY.getTime() + TEST_COOLDOWN_SECONDS * 1000))
    await call('send_test_weekly_email')
    expect(mailer.sent).toHaveLength(2)
  })

  it('shows why the email could not be sent', async () => {
    mailer.failWith = 'Leeway could not reach Resend: fetch failed'
    const error = await callError('send_test_weekly_email')
    expect(error).toMatchObject({
      code: 'mail_error',
      status: 502,
      message: 'Leeway could not reach Resend: fetch failed',
    })
    // A failed test is the owner's to see right away, not a scheduled failure.
    expect((await call('get_weekly_email')).lastError).toBeNull()
  })

  it('says what to set when the server cannot send email', async () => {
    ctx.mailer = null
    expect((await callError('send_test_weekly_email')).code).toBe('not_configured')
  })
})
