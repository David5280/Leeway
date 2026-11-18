// Putting the weekly email together and sending it: on schedule, as a test,
// and what the app shows about it.

import type { AppContext } from '../../context.js'
import { AppError, messageOf } from '../../errors.js'
import { todayIn, type IsoDate } from '../../lib/dates.js'
import { formatCents } from '../../lib/money.js'
import type { EmailMessage } from '../../mail/sender.js'
import { getCashFlow } from '../cashFlow.js'
import { getCheckin } from '../checkin.js'
import { getOwner } from '../owner.js'
import { getSettings, type Settings } from '../settings.js'
import { getSummary } from '../summary.js'
import { weeklyEmailContent } from './content.js'
import { weeklyEmailHtml } from './html.js'
import { dueSlot, nextSendAt } from './schedule.js'
import {
  claimSlot,
  claimTestSend,
  getWeeklyEmail,
  recordFailure,
  recordSent,
  type WeeklyEmailRow,
} from './store.js'
import { weeklyEmailText } from './text.js'

/** How often the server checks whether the weekly email is due. */
export const WEEKLY_EMAIL_CHECK_MINUTES = 5

/** The least time between two test emails, so the button cannot flood an inbox. */
export const TEST_COOLDOWN_SECONDS = 30

/** What a scheduled check did, for the log and for tests. */
export type SendOutcome = 'unavailable' | 'not_due' | 'claimed_elsewhere' | 'sent' | 'failed'

/** What the app shows about the weekly email. */
export interface WeeklyEmailView {
  /** False until the server has RESEND_API_KEY and MAIL_FROM. */
  available: boolean
  on: boolean
  /** The address chosen, or null for the owner's sign-in email. */
  sendTo: string | null
  ownerEmail: string | null
  weekday: number
  hour: number
  /** The owner's time zone, which the day and hour are in. */
  timeZone: string
  nextSendAt: string | null
  lastSentAt: string | null
  /** The last failed try, until an email goes out again. */
  lastError: { message: string; at: string } | null
  /** The address the email's button opens; null when the server does not know it. */
  linksTo: string | null
}

/** The email for today's numbers, as it would go out now. */
async function composeWeeklyEmail(
  ctx: AppContext,
  settings: Settings,
  today: IsoDate,
): Promise<Omit<EmailMessage, 'to'>> {
  const [summary, checkin, cashFlow] = await Promise.all([
    getSummary(ctx, settings, today),
    getCheckin(ctx.db, settings, ctx.now(), today),
    getCashFlow(ctx.db, settings, today),
  ])
  const content = weeklyEmailContent({
    summary,
    checkin,
    billsDue: cashFlow.billsDue,
    settings,
    money: (cents) => formatCents(cents, settings.currency, settings.locale),
    appUrl: ctx.config.publicUrl,
  })
  return {
    subject: content.subject,
    html: weeklyEmailHtml(content),
    text: weeklyEmailText(content),
  }
}

/** The address chosen in the app, or else the owner's sign-in email. */
async function recipient(ctx: AppContext, row: WeeklyEmailRow): Promise<string> {
  const to = row.sendTo ?? (await getOwner(ctx.db))?.email
  if (!to) throw new AppError('not_found', 'There is no address to send the email to')
  return to
}

/**
 * Sends this week's email if it is due. Run on a timer: most calls find
 * nothing due. A failed send is recorded for the app to show and tried again
 * later in the week (see schedule.ts).
 */
export async function sendWeeklyEmailIfDue(ctx: AppContext): Promise<SendOutcome> {
  const mailer = ctx.mailer
  if (!mailer) return 'unavailable'
  const now = ctx.now()
  const [row, settings] = await Promise.all([getWeeklyEmail(ctx.db), getSettings(ctx.db)])
  const slot = dueSlot(row, row, settings.timeZone, now)
  if (!slot) return 'not_due'
  // Another server got there first, or the owner changed something since the read.
  if (!(await claimSlot(ctx.db, row, slot, now))) return 'claimed_elsewhere'

  try {
    const to = await recipient(ctx, row)
    const message = await composeWeeklyEmail(ctx, settings, todayIn(settings.timeZone, now))
    await mailer.send({ to, ...message })
  } catch (error) {
    await recordFailure(ctx.db, messageOf(error), ctx.now())
    return 'failed'
  }
  await recordSent(ctx.db, slot, ctx.now())
  return 'sent'
}

/** Sends the email as it would go out now, marked as a test. Leaves the schedule alone. */
export async function sendTestEmail(ctx: AppContext): Promise<{ sentTo: string }> {
  const mailer = ctx.mailer
  if (!mailer) {
    throw new AppError(
      'not_configured',
      'Add RESEND_API_KEY and MAIL_FROM to the server to send email',
    )
  }
  const now = ctx.now()
  const to = await recipient(ctx, await getWeeklyEmail(ctx.db))
  if (!(await claimTestSend(ctx.db, now, TEST_COOLDOWN_SECONDS))) {
    throw new AppError(
      'conflict',
      'A test email just went out. Wait half a minute to send another.',
    )
  }
  const settings = await getSettings(ctx.db)
  const message = await composeWeeklyEmail(ctx, settings, todayIn(settings.timeZone, now))
  try {
    await mailer.send({ to, ...message, subject: `Test: ${message.subject}` })
  } catch (error) {
    throw new AppError('mail_error', messageOf(error))
  }
  return { sentTo: to }
}

export async function weeklyEmailView(ctx: AppContext): Promise<WeeklyEmailView> {
  const [row, settings, owner] = await Promise.all([
    getWeeklyEmail(ctx.db),
    getSettings(ctx.db),
    getOwner(ctx.db),
  ])
  const next = nextSendAt(row, row, settings.timeZone, ctx.now())
  return {
    available: ctx.mailer !== null,
    on: row.on,
    sendTo: row.sendTo,
    ownerEmail: owner?.email ?? null,
    weekday: row.weekday,
    hour: row.hour,
    timeZone: settings.timeZone,
    nextSendAt: next?.toISOString() ?? null,
    lastSentAt: row.sentAt?.toISOString() ?? null,
    // A successful send clears the error, so one stored here is still unresolved.
    lastError:
      row.lastError && row.lastErrorAt
        ? { message: row.lastError, at: row.lastErrorAt.toISOString() }
        : null,
    linksTo: ctx.config.publicUrl,
  }
}
