// Step 6: finished. Says how money gets in from here, and offers a key for an AI assistant.

import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { Status } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { settingsPath } from '../settings/paths'
import { Frame, Nav } from './Frame'

/** Where someone without bank sync adds their money, once setup is done. */
const NEXT_STEPS = [
  {
    path: '/transactions/import',
    title: 'Import a CSV file',
    text: "Download your transactions from your bank's website, then bring them in",
  },
  {
    path: settingsPath('accounts'),
    title: 'Add an account by hand',
    text: 'Type in an account and its balance, then add spending as it happens',
  },
] as const

export function DoneStep({ status }: { status: Status }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const connections = useAction('list_connections', undefined, { enabled: status.bank !== null })
  const synced = (connections.data ?? []).some((c) => c.accountCount > 0)

  /** Leaves setup for a screen. The owner was marked set up on the step before. */
  function finishAt(path: string) {
    navigate(path)
    void client.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <Frame step={6}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          finishAt('/')
        }}
      >
        <h1>You&apos;re set</h1>
        {synced ? (
          <p className="muted">
            Leeway syncs your bank as things happen, and on a timer as a backup.
          </p>
        ) : (
          <>
            <p className="muted">Next, bring in your money. Pick one now, or do it later.</p>
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
            >
              {NEXT_STEPS.map((step) => (
                <button
                  key={step.path}
                  type="button"
                  className="choice"
                  onClick={() => finishAt(step.path)}
                >
                  {step.title}
                  <span>{step.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <AssistantKey status={status} />
        <Nav next="Open my overview" />
      </form>
    </Frame>
  )
}

/** Optional: a read-only key and the address an AI assistant connects to. */
function AssistantKey({ status }: { status: Status }) {
  const create = useActionMutation('create_token')
  const address = `${status.publicUrl ?? window.location.origin}/mcp`
  return (
    <div className="card soft stack-sm">
      <strong>Optional: let your AI assistant keep an eye on it</strong>
      <span className="small muted">
        Create a read-only key and add this address as a connector in your assistant. It can then
        check your budgets and warn you. You can do this later in Settings, then AI assistant.
      </span>
      <code className="code">{address}</code>
      {create.data ? (
        <>
          <span className="small">Your key, shown only once. Copy it now:</span>
          <code className="code">{create.data.token}</code>
        </>
      ) : (
        <div>
          <button
            type="button"
            className="btn"
            disabled={create.isPending}
            onClick={() => create.mutate({ name: 'AI assistant', scope: 'read' })}
          >
            Create a key
          </button>
        </div>
      )}
      <ErrorNote error={create.error} />
    </div>
  )
}
