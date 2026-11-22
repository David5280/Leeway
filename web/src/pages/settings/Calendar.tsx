// Linking a calendar by its private address, so trips, weddings and other
// events that cost money show in Plan next to bills and paydays. The address
// is a secret: it goes to the server once and is never shown again. Only
// events likely to cost money are kept, and unlinking asks once more.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote, LoadingOrError } from '../../components/ui'
import { timeAgo } from '../../lib/format'
import { Section } from './Section'

function ConnectForm() {
  const connect = useActionMutation('connect_calendar')
  const [url, setUrl] = useState('')
  return (
    <form
      className="stack-sm"
      onSubmit={(event) => {
        event.preventDefault()
        connect.mutate({ url }, { onSuccess: () => setUrl('') })
      }}
    >
      <span className="small muted">
        Paste your calendar&apos;s private address (in Google Calendar, Settings, then Secret
        address in iCal format; in Apple Calendar, share the calendar publicly and copy its link).
        Leeway reads it every few hours and keeps the address to itself.
      </span>
      <label className="field">
        Calendar link
        <input
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://… .ics"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <div>
        <button type="submit" className="btn primary" disabled={!url.trim() || connect.isPending}>
          {connect.isPending ? 'Reading the calendar…' : 'Connect a calendar'}
        </button>
      </div>
      <ErrorNote error={connect.error} />
    </form>
  )
}

/** Unlinking asks once more, since the calendar's link has to be found and pasted again. */
function Unlink() {
  const disconnect = useActionMutation('disconnect_calendar')
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button type="button" className="btn" onClick={() => setConfirming(true)}>
        Unlink
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        className="btn danger"
        disabled={disconnect.isPending}
        onClick={() => disconnect.mutate({})}
      >
        Unlink the calendar
      </button>
      <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
        Keep it
      </button>
      <ErrorNote error={disconnect.error} />
    </>
  )
}

export function CalendarSection() {
  const status = useAction('calendar_status')
  const refresh = useActionMutation('refresh_calendar')
  if (!status.data) {
    return (
      <Section id="calendar" title="Calendar">
        <LoadingOrError error={status.error} />
      </Section>
    )
  }
  const calendar = status.data
  return (
    <Section id="calendar" title="Calendar">
      {calendar.connected ? (
        <>
          <div className="stack-sm" style={{ gap: 2 }}>
            <span style={{ fontWeight: 500 }}>Linked to {calendar.host}</span>
            <span className="small muted">
              {calendar.eventCount} {calendar.eventCount === 1 ? 'event' : 'events'} that may cost
              money, read {timeAgo(calendar.fetchedAt)}
            </span>
          </div>
          {calendar.lastError && <p className="notice error">{calendar.lastError}</p>}
          {/* The read worked, so this is said quietly, not as a failure. */}
          {calendar.note && (
            <p className="notice" role="status">
              {calendar.note}
            </p>
          )}
          <div className="row wrap">
            <button
              type="button"
              className="btn"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate({})}
            >
              Read it now
            </button>
            <Unlink />
          </div>
          <ErrorNote error={refresh.error} />
        </>
      ) : (
        <ConnectForm />
      )}
    </Section>
  )
}
