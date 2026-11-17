// Step 5: finished, with an optional key for an AI assistant.

import { useQueryClient } from '@tanstack/react-query'
import type { Status } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { Frame, Nav } from './Frame'

export function DoneStep({ status }: { status: Status }) {
  const client = useQueryClient()
  const create = useActionMutation('create_token')
  const address = `${status.publicUrl ?? window.location.origin}/mcp`
  return (
    <Frame step={5}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void client.invalidateQueries({ queryKey: ['me'] })
        }}
      >
        <h1>You're set</h1>
        <p className="muted">
          Leeway syncs when your bank has news, and every 6 hours as a backup. One more optional
          thing:
        </p>
        <div className="card soft stack-sm">
          <strong>Let your AI assistant keep an eye on it</strong>
          <span className="small muted">
            Create a read-only key and add this address as a connector. Your assistant can then
            check budgets and warn you.
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
        <Nav next="Open my overview" />
      </form>
    </Frame>
  )
}
