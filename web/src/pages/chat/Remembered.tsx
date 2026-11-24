// What the owner told Leeway to keep in mind, each with a way to forget it.

import { useActionMutation } from '../../api/hooks'
import type { Output } from '../../api/client'
import { ErrorNote } from '../../components/ui'

type Fact = Output<'get_chat'>['facts'][number]

/** "1 thing" or "3 things". */
export function thingsCount(count: number): string {
  return count === 1 ? '1 thing' : `${count} things`
}

export function Remembered({ facts }: { facts: readonly Fact[] }) {
  const forget = useActionMutation('forget_fact')
  if (facts.length === 0) return null
  return (
    <details className="card chat-facts">
      <summary>Leeway remembers {thingsCount(facts.length)}</summary>
      <p className="small muted">
        Sent with every question so answers fit your plans. Forget anything that no longer holds.
      </p>
      <ul className="chat-fact-list">
        {facts.map((fact) => (
          <li key={fact.id} className="row-between">
            <span>{fact.text}</span>
            <button
              type="button"
              className="btn small ghost"
              aria-label={`Forget: ${fact.text}`}
              disabled={forget.isPending}
              onClick={() => forget.mutate({ id: fact.id })}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={forget.error} />
    </details>
  )
}
