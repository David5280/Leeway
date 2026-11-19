// The weekly email: on or off, its day and hour, where it goes, a test send,
// and how the last send went. All of it is the owner's alone; an assistant
// can neither see nor change it.

import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote, Loading, Setting, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import { AddressField } from './email/AddressField'
import {
  hourLabel,
  momentLabel,
  scheduleText,
  weekdayNames,
  type WeeklyEmailView,
} from './email/emailText'
import { Section } from './Section'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

export function EmailSection() {
  const view = useAction('get_weekly_email')
  return (
    <Section id="email" title="Email">
      {view.data && <EmailSettings view={view.data} />}
      {view.isPending && <Loading label="Loading email settings" />}
      <ErrorNote error={view.error} />
    </Section>
  )
}

function EmailSettings({ view }: { view: WeeklyEmailView }) {
  const { settings } = useApp()
  const update = useActionMutation('set_weekly_email')
  // While a change saves, show it already, as the other settings do.
  const shown = { ...view, ...(update.isPending ? update.variables : {}) }
  const days = weekdayNames(settings.locale)
  const status = scheduleText(view, settings.locale)

  return (
    <>
      {!view.available && <SetupNotice />}
      <Setting
        label="Weekly email"
        hint="The dashboard summary, what is left, Heads up, bills before payday and goals"
      >
        <Switch
          checked={Boolean(shown.on)}
          label="Send me a weekly email"
          // Turning it off always works, even after the server's email keys are removed.
          disabled={(!view.available && !view.on) || update.isPending}
          onChange={(on) => update.mutate({ on })}
        />
      </Setting>
      <Setting label="Day and time" hint={`In your time zone, ${view.timeZone}`}>
        <div className="row">
          <select
            className="input"
            style={{ width: 'auto' }}
            aria-label="Day"
            value={shown.weekday}
            onChange={(e) => update.mutate({ weekday: Number(e.target.value) })}
          >
            {days.map((name, day) => (
              <option key={name} value={day}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ width: 'auto' }}
            aria-label="Hour"
            value={shown.hour}
            onChange={(e) => update.mutate({ hour: Number(e.target.value) })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour, settings.locale)}
              </option>
            ))}
          </select>
        </div>
      </Setting>
      <ErrorNote error={update.error} />
      <AddressField sendTo={view.sendTo} ownerEmail={view.ownerEmail} />
      {status && <span className="small muted">{status}</span>}
      {view.lastError && (
        <p className="notice error" role="alert">
          The email on {momentLabel(view.lastError.at, view.timeZone, settings.locale)} could not be
          sent: {view.lastError.message}
        </p>
      )}
      {view.available && !view.linksTo && (
        <span className="small muted">
          Set <code className="code">PUBLIC_URL</code> on the server to give the email a button that
          opens Leeway.
        </span>
      )}
      <TestEmail available={view.available} />
    </>
  )
}

/** What to set on the server before any email can go out. */
function SetupNotice() {
  return (
    <p className="notice">
      To send email, add <code className="code">RESEND_API_KEY</code> and{' '}
      <code className="code">MAIL_FROM</code> to your server&apos;s variables (on Railway: the
      Leeway service, then Variables). Make the key at resend.com, and verify the domain of the
      MAIL_FROM address there. Nothing is sent until you turn the email on here.
    </p>
  )
}

function TestEmail({ available }: { available: boolean }) {
  const test = useActionMutation('send_test_weekly_email')
  return (
    <div className="stack-sm">
      <div>
        <button
          type="button"
          className="btn ghost"
          disabled={!available || test.isPending}
          onClick={() => test.mutate({})}
        >
          {test.isPending ? 'Sending' : 'Send a test email now'}
        </button>
      </div>
      {test.data && <p className="small good">Test email sent to {test.data.sentTo}.</p>}
      <ErrorNote error={test.error} />
    </div>
  )
}
