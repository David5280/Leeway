// Words for the weekly email settings: day and hour names in the owner's
// language, and what the last and next sends say. Pure, no React.

import type { Output } from '../../../api/client'

export type WeeklyEmailView = Output<'get_weekly_email'>

/** Day names, Sunday first, matching the server's 0 to 6: ["Sunday", "Monday", ...]. */
export function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  // Jan 4, 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => format.format(Date.UTC(1970, 0, 4 + day)))
}

/** An hour of the day as the owner's clock shows it: "8 AM" or "08". */
export function hourLabel(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(1970, 0, 1, hour),
  )
}

/** A moment on the owner's clock: "Mon, Nov 23, 8:00 AM". */
export function momentLabel(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Under the address: where the email goes when none is named, or how to go back to that. */
export function addressHint(sendTo: string | null, ownerEmail: string | null): string {
  if (sendTo) return 'Clear the address and save to go back to your sign-in email.'
  if (!ownerEmail) return 'Goes to your sign-in email unless you name another.'
  return `Goes to your sign-in email, ${ownerEmail}, unless you name another.`
}

/** One line on where the weekly email stands, or null while there is nothing to say. */
export function scheduleText(
  view: WeeklyEmailView,
  locale: string,
  now = Date.now(),
): string | null {
  const when = (iso: string) => momentLabel(iso, view.timeZone, locale)
  const last = view.lastSentAt ? `Last sent ${when(view.lastSentAt)}.` : null
  if (!view.on || !view.nextSendAt) return last
  // Due now means the server sends on its next check, a few minutes at most.
  const next =
    new Date(view.nextSendAt).getTime() <= now
      ? 'The next email goes out in the next few minutes.'
      : `Next email ${when(view.nextSendAt)}.`
  return last ? `${next} ${last}` : next
}
