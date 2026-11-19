// The widget's token: made here, shown once as the widget's parameter, and
// revoked here. There is one, so making a new one replaces the old.

import { useAction, useActionMutation } from '../../../api/hooks'
import { CopyField } from '../../../components/CopyField'
import { ErrorNote } from '../../../components/ui'
import { calendarDate, timeAgo } from '../../../lib/format'

/** What the widget's Parameter holds: this server's address and the token. */
export function widgetParameter(server: string, token: string): string {
  return `${server}|${token}`
}

export function WidgetToken({ server }: { server: string }) {
  const current = useAction('get_widget_token')
  const create = useActionMutation('create_widget_token')
  const revoke = useActionMutation('revoke_widget_token')
  const token = current.data
  // The new token stays on screen until it is replaced or revoked.
  const shown = create.data && token ? create.data.token : null

  return (
    <div className="stack-sm">
      <h3>Token</h3>
      {token ? (
        <div className="list-row">
          <span className="grow">
            Widget
            <br />
            <span className="small muted">
              Made {calendarDate(token.createdAt)}, last used {timeAgo(token.lastUsedAt)}
            </span>
          </span>
          <button
            type="button"
            className="btn small danger"
            aria-label="Revoke the widget token"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({}, { onSuccess: () => create.reset() })}
          >
            Revoke
          </button>
        </div>
      ) : (
        current.isSuccess && <span className="small muted">No widget token yet.</span>
      )}
      {shown && (
        <div className="notice stack-sm">
          <span>
            Your widget parameter, shown only once. Copy it now, and paste it into the widget&apos;s
            Parameter:
          </span>
          <CopyField value={widgetParameter(server, shown)} label="Widget parameter" />
          {!server.startsWith('https://') && (
            <span className="small">
              The widget only sends its token over https, so it needs Leeway at a public https
              address. Deploy Leeway or set PUBLIC_URL, then make a new token here.
            </span>
          )}
        </div>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={create.isPending || !current.isSuccess}
          onClick={() => create.mutate({})}
        >
          {token ? 'Make a new token' : 'Create the widget token'}
        </button>
        {token && (
          <span className="small muted">A new token stops the old one working at once.</span>
        )}
      </div>
      <ErrorNote error={current.error ?? create.error ?? revoke.error} />
    </div>
  )
}
