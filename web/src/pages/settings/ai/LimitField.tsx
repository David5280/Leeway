// The monthly AI limit, typed in dollars. A call that could pass it is
// refused, and the feature falls back to what Leeway does by itself. The
// field holds a plain amount ("1000.00") beside a "$", never one written in
// the owner's number style: "1.000,00 $" would not read back as an amount.

import { useId, useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { ErrorNote, Setting } from '../../../components/ui'
import { typedAmount } from '../../../lib/money'
import { readCap, type CapProblem } from './aiText'
import { CapProblemText } from './Dollars'

export function LimitField({ capCents }: { capCents: number }) {
  const set = useActionMutation('set_ai_limit')
  const [text, setText] = useState(() => typedAmount(capCents))
  const [problem, setProblem] = useState<CapProblem | null>(null)
  const hintId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    const read = readCap(text)
    setProblem(read.ok ? null : read.problem)
    if (!read.ok) return
    set.mutate(
      { monthlyCapCents: read.cents },
      { onSuccess: (usage) => setText(typedAmount(usage.monthlyCapCents)) },
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
          {/* The label already says US dollars, so the sign is for the eye only. */}
          <span className="ai-limit-unit" aria-hidden="true">
            $
          </span>
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
