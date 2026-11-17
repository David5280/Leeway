// Connecting an AI assistant: the MCP address and access keys.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { timeAgo } from '../../lib/format'
import { Section } from './Section'

export function AgentSection() {
  const { status } = useApp()
  const tokens = useAction('list_tokens')
  const create = useActionMutation('create_token')
  const remove = useActionMutation('delete_token')
  const [name, setName] = useState('AI assistant')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const address = `${status.publicUrl ?? window.location.origin}/mcp`

  return (
    <Section
      id="agent"
      title="AI assistant"
      hint="Connect Claude or another assistant over MCP so it can check in and coach you"
    >
      <span className="small">
        Add this address as a connector, with a key from below as the bearer token:
      </span>
      <code className="code">{address}</code>
      {tokens.data?.map((t) => (
        <div key={t.id} className="list-row">
          <span className="grow">
            {t.name}
            <br />
            <span className="small muted">
              {t.scope === 'read' ? 'Can look' : 'Can look and change'}, last used{' '}
              {timeAgo(t.lastUsedAt)}
            </span>
          </span>
          <button
            type="button"
            className="linkbtn small"
            onClick={() => remove.mutate({ id: t.id })}
          >
            Revoke
          </button>
        </div>
      ))}
      {create.data && (
        <div className="notice stack-sm">
          <span>Your new key, shown only once. Copy it now:</span>
          <code className="code">{create.data.token}</code>
        </div>
      )}
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ name, scope })
        }}
      >
        <input
          className="input"
          style={{ width: 200 }}
          aria-label="Key name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="What the key can do"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'read' | 'write')}
        >
          <option value="read">Can look (read-only)</option>
          <option value="write">Can look and change budgets</option>
        </select>
        <button type="submit" className="btn" disabled={create.isPending}>
          Create a key
        </button>
      </form>
      <span className="small muted">Neither kind of key can ever move money.</span>
      <ErrorNote error={tokens.error ?? create.error ?? remove.error} />
    </Section>
  )
}
