// Keys for assistants that take a bearer token instead of signing in.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'
import { CopyField } from '../../../components/CopyField'
import { ErrorNote } from '../../../components/ui'
import { calendarDate, timeAgo } from '../../../lib/format'

/** "Key 1", "Key 2"...: the first such name not already taken, so new keys are easy to tell apart. */
export function nextKeyName(taken: readonly string[]): string {
  const names = new Set(taken)
  let n = taken.length + 1
  for (let i = 1; i <= taken.length; i++) {
    if (!names.has(`Key ${i}`)) {
      n = i
      break
    }
  }
  return `Key ${n}`
}

export function AgentKeys() {
  const tokens = useAction('list_tokens')
  const create = useActionMutation('create_token')
  const remove = useActionMutation('delete_token')
  // Null means "use the suggested name", which moves on after each new key.
  const [name, setName] = useState<string | null>(null)
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const suggested = nextKeyName(tokens.data?.map((t) => t.name) ?? [])

  return (
    <div className="stack-sm">
      <h3>Keys</h3>
      {tokens.data?.length === 0 && <span className="small muted">No keys yet.</span>}
      {tokens.data?.map((t) => (
        <div key={t.id} className="list-row">
          <span className="grow">
            {t.name}
            <br />
            <span className="small muted">
              {t.scope === 'read' ? 'Can look' : 'Can look and change'}, made{' '}
              {calendarDate(t.createdAt)}, last used {timeAgo(t.lastUsedAt)}
            </span>
          </span>
          <button
            type="button"
            className="btn small danger"
            aria-label={`Revoke ${t.name}`}
            onClick={() => remove.mutate({ id: t.id })}
          >
            Revoke
          </button>
        </div>
      ))}
      {create.data && (
        <div className="notice stack-sm">
          <span>Your new key &quot;{create.data.name}&quot;, shown only once. Copy it now:</span>
          <CopyField value={create.data.token} label="New key" />
        </div>
      )}
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ name: name ?? suggested, scope }, { onSuccess: () => setName(null) })
        }}
      >
        <input
          className="input"
          style={{ width: 200 }}
          aria-label="Key name"
          required
          value={name ?? suggested}
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
      <ErrorNote error={tokens.error ?? create.error ?? remove.error} />
    </div>
  )
}
