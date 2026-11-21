// Linking a calendar by its private address, so trips, weddings and other
// events that cost money show in Plan next to bills and paydays. The address
// is a secret: it goes to the server once and is never shown again.

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

export function CalendarSection() {
  const status = useAction('calendar_status')
  const refresh = useActionMutation('refresh_calendar')
  const disconnect = useActionMutation('disconnect_calendar')
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
              {calendar.eventCount} {calendar.eventCount === 1 ? 'event' : 'events'}, read{' '}
              {timeAgo(calendar.fetchedAt)}
            </span>
          </div>
          {calendar.lastError && <p className="notice error">{calendar.lastError}</p>}
          <div className="row wrap">
            <button
              type="button"
              className="btn"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate({})}
            >
              Read it now
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate({})}
            >
              Unlink
            </button>
          </div>
          <ErrorNote error={refresh.error ?? disconnect.error} />
        </>
      ) : (
        <ConnectForm />
      )}
    </Section>
  )
}
