// The owner's switch for Claude writing the dashboard summary. It sends a few
// of their numbers to Anthropic, so this page says exactly what goes.

import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting, Switch } from '../../../components/ui'
import { useApp } from '../../../lib/app'

export function SummarySetting() {
  const { settings } = useApp()
  const toggle = useActionMutation('set_ai_summary')
  // Only asked while it is on: the summary says whether the server has a key.
  const summary = useAction('get_summary', undefined, { enabled: settings.aiSummary })
  const on = toggle.isPending ? toggle.variables.on : settings.aiSummary

  return (
    <div className="stack-sm">
      <h3>Dashboard summary</h3>
      <Setting
        label="Have Claude write it"
        hint="Off, Leeway writes it from your numbers by itself"
      >
        <Switch
          checked={on}
          label="Have Claude write the dashboard summary"
          disabled={toggle.isPending}
          onChange={(checked) => toggle.mutate({ on: checked })}
        />
      </Setting>
      <span className="small muted">
        When on, Leeway sends Anthropic this period&apos;s totals, cash until payday, the Heads up
        list, your bill and goal names, and any account alerts by account name, a few times a day at
        most. Never account numbers or transactions. Each summary costs a few cents on your own
        Anthropic account.
      </span>
      {on && summary.data?.ai === 'no_key' && (
        <p className="notice">
          Add <code>ANTHROPIC_API_KEY</code> to your server&apos;s variables (on Railway: the Leeway
          service, then Variables). You can make a key at console.anthropic.com. Until then, Leeway
          writes the summary.
        </p>
      )}
      <ErrorNote error={toggle.error} />
    </div>
  )
}
