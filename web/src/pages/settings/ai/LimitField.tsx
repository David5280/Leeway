// The monthly AI limit, typed in dollars. A call that could pass it is
// refused, and the feature falls back to what Leeway does by itself.

import { useId, useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { dollars, readCap, type CapProblem } from './aiText'
import { CapProblemText } from './Dollars'

export function LimitField({ capCents, locale }: { capCents: number; locale: string }) {
  const set = useActionMutation('set_ai_limit')
  const [text, setText] = useState(() => dollars(capCents, locale))
  const [problem, setProblem] = useState<CapProblem | null>(null)
  const hintId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    const read = readCap(text)
    setProblem(read.ok ? null : read.problem)
    if (!read.ok) return
    set.mutate(
      { monthlyCapCents: read.cents },
      { onSuccess: (usage) => setText(dollars(usage.monthlyCapCents, locale)) },
    )
  }

  return (
    <form className="stack-sm" aria-label="Monthly AI limit" onSubmit={submit}>
      <Setting
        label="Monthly limit"
        hint="The most AI may spend in a month. $0 turns paid AI off."
        hintId={hintId}
      >
        <div className="row ai-limit">
          <input
            className="input num"
            inputMode="decimal"
            aria-label="Monthly limit in US dollars"
            aria-describedby={hintId}
            aria-invalid={problem !== null}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              set.reset()
            }}
          />
          <button type="submit" className="btn" disabled={set.isPending}>
            Save
          </button>
        </div>
      </Setting>
      {problem && (
        <p className="small over" role="alert">
          <CapProblemText problem={problem} />
        </p>
      )}
      {set.isSuccess && <p className="small good">Limit saved.</p>}
      <ErrorNote error={set.error} />
    </form>
  )
}
