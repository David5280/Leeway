// Apps the owner approved by signing in, like Claude, and disconnecting them.

import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote } from '../../../components/ui'
import { calendarDate, timeAgo } from '../../../lib/format'

export function ConnectedApps() {
  const apps = useAction('list_connected_apps')
  const disconnect = useActionMutation('disconnect_app')

  return (
    <div className="stack-sm">
      <h3>Connected apps</h3>
      {apps.data?.length === 0 && (
        <span className="small muted">Nothing connected yet. Follow the steps above.</span>
      )}
      {apps.data?.map((app) => (
        <div key={app.id} className="list-row">
          <span className="grow">
            {app.name} <span className="muted">({app.host})</span>
            <br />
            <span className="small muted">
              {app.scope === 'read' ? 'Can look' : 'Can look and change'}, connected{' '}
              {calendarDate(app.connectedAt)}, last used {timeAgo(app.lastUsedAt)}
            </span>
          </span>
          <button
            type="button"
            className="btn small danger"
            aria-label={`Disconnect ${app.name}`}
            onClick={() => disconnect.mutate({ id: app.id })}
          >
            Disconnect
          </button>
        </div>
      ))}
      <ErrorNote error={apps.error ?? disconnect.error} />
    </div>
  )
}
