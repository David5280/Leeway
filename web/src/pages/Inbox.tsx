// The inbox: every alert as it happened, newest first. Opening one marks it
// read and goes to the screen that explains it; dismissing takes it away.
// Unread means not yet opened or marked read, cleared or not: the bell counts
// the same, and Mark all read shows while any is.

import { Link } from 'react-router-dom'
import type { Output } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { useBellCount } from '../components/Bell'
import { Shell } from '../components/Shell'
import { Card, ErrorNote, LoadingOrError } from '../components/ui'
import { timeAgo } from '../lib/format'
import { settingsPath } from './settings/paths'

export type InboxItem = Output<'list_notifications'>['items'][number]

export function Inbox() {
  const inbox = useAction('list_notifications')
  const markRead = useActionMutation('mark_notifications_read')
  const unread = inbox.data?.unread ?? 0
  useBellCount(inbox.data?.unread)
  return (
    <Shell>
      <div className="inbox-head">
        <h1>Inbox</h1>
        {unread > 0 && (
          <button
            type="button"
            className="btn ghost small"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate({})}
          >
            Mark all read
          </button>
        )}
      </div>
      <Card label="Notifications" className="tight">
        {inbox.data ? (
          <InboxList items={inbox.data.items} />
        ) : (
          <div style={{ padding: 14 }}>
            <LoadingOrError error={inbox.error} label="Loading the inbox" />
          </div>
        )}
      </Card>
      <ErrorNote error={markRead.error} />
      <p className="small muted">
        Choose what comes here, and what reaches your phone, in{' '}
        <Link to={settingsPath('notifications')}>Settings, then Notifications</Link>.
      </p>
    </Shell>
  )
}

function InboxList({ items }: { items: InboxItem[] }) {
  if (items.length === 0) {
    return <p className="empty">Nothing new. Alerts show here as they happen.</p>
  }
  return (
    <ul className="inbox-list">
      {items.map((item) => (
        <InboxRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

function InboxRow({ item }: { item: InboxItem }) {
  const markRead = useActionMutation('mark_notifications_read')
  const dismiss = useActionMutation('dismiss_notification')
  const unread = item.readAt === null
  const when = timeAgo(new Date(item.createdAt).toISOString())
  // The message names the account, budget or bill, so each row's buttons read apart.
  const about = `${item.title}: ${item.message}`
  return (
    <li className={unread ? 'inbox-item unread' : 'inbox-item'}>
      <div className="inbox-text">
        <span className="inbox-title">
          {unread && <span className="visually-hidden">Unread: </span>}
          {item.title}
          {item.resolvedAt !== null && <span className="badge">Cleared</span>}
        </span>
        <span>{item.message}</span>
        <span className="small muted">{when}</span>
      </div>
      <div className="inbox-actions">
        <Link
          to={item.link}
          className="btn ghost small"
          aria-label={`Open ${about}`}
          onClick={() => {
            if (unread) markRead.mutate({ ids: [item.id] })
          }}
        >
          Open
        </Link>
        <button
          type="button"
          className="btn ghost small"
          aria-label={`Dismiss ${about}`}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ id: item.id })}
        >
          Dismiss
        </button>
      </div>
      <ErrorNote error={dismiss.error} />
    </li>
  )
}
