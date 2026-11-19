// This month's AI spending alert, raised once at 80% of the limit and again
// when a call is refused for it. Dismissing hides it; the limit still holds.

import { Link } from 'react-router-dom'
import type { Output } from '../api/client'
import { useActionMutation } from '../api/hooks'
import { settingsPath } from '../pages/settings/paths'
import { Icon } from './ui'

type SpendAlert = NonNullable<Output<'get_ai_usage'>['alert']>

export function AiSpendAlert({
  alert,
  linked = false,
}: {
  alert: SpendAlert
  /** Adds a link to Settings > AI models, for where the alert shows away from it. */
  linked?: boolean
}) {
  const dismiss = useActionMutation('dismiss_ai_alert')
  const limit = alert.level === 'limit'
  return (
    <div className="alert-row ai-alert">
      <span className={`alert-icon ${limit ? '' : 'info'}`}>
        <Icon name={limit ? 'warn' : 'info'} size={16} />
      </span>
      <span className="grow">
        {alert.message}
        {linked && (
          <>
            {' '}
            <Link to={settingsPath('ai')}>AI models</Link>
          </>
        )}
      </span>
      <button
        type="button"
        className="btn small ghost"
        aria-label="Dismiss the AI spending alert"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate({})}
      >
        Dismiss
      </button>
    </div>
  )
}
