// Starting the conversation over, asked twice. Focus never falls to the top
// of the page: asking moves it to Keep, the safe choice; Keep brings it
// back to Start over; and once deleted, the conversation and this button
// are gone, so onCleared puts it somewhere useful (the question box).

import { useEffect, useRef, useState } from 'react'
import { useActionMutation } from '../../api/hooks'

export function StartOver({ onCleared }: { onCleared: () => void }) {
  const clear = useActionMutation('clear_chat')
  const [sure, setSure] = useState(false)
  const start = useRef<HTMLButtonElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  // Set only by a choice, so focus never moves when the screen first draws.
  const chosen = useRef(false)

  useEffect(() => {
    if (!chosen.current) return
    const target = sure ? keep : start
    target.current?.focus()
  }, [sure])

  const choose = (next: boolean) => {
    chosen.current = true
    setSure(next)
  }

  if (!sure) {
    return (
      <button ref={start} type="button" className="btn small ghost" onClick={() => choose(true)}>
        Start over
      </button>
    )
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small muted">Delete this conversation?</span>
      <button
        type="button"
        className="btn small"
        disabled={clear.isPending}
        onClick={() => clear.mutate({}, { onSuccess: onCleared })}
      >
        Delete
      </button>
      <button ref={keep} type="button" className="btn small ghost" onClick={() => choose(false)}>
        Keep
      </button>
    </div>
  )
}
