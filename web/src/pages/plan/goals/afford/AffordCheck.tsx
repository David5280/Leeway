// "Can I afford it?" on Goals: type a thing and its price, and Leeway answers
// in plain words from its own check (when_can_i_afford, which carries
// can_i_afford's verdict), never an AI, so it works with no AI key. A "tight"
// or "not yet" answer offers "Save for it", which opens a purchase goal
// filled in from what was typed and the day saving would get there.

import { useState, type FormEvent } from 'react'
import { useAction } from '../../../../api/hooks'
import { AmountNote, useAmountField } from '../../../../components/AmountNote'
import { Card } from '../../../../components/design/Card'
import { SectionHead } from '../../../../components/design/SectionHead'
import { ErrorNote, Setting } from '../../../../components/ui'
import { useApp } from '../../../../lib/app'
import { longDate, parseMoney, periodWord } from '../../../../lib/format'
import type { GoalDraft } from '../GoalForm'
import { affordAnswer, goalDraftFor, type Asked, type PurchasePlan } from './affordText'

/** The answer under the form, read out as it arrives. */
function Answer({
  asked,
  plan,
  onSaveFor,
}: {
  asked: Asked
  plan: PurchasePlan
  onSaveFor: (draft: GoalDraft) => void
}) {
  const { money, settings } = useApp()
  // The saved-by day can be a year or more away, so it keeps its year.
  const date = (iso: string) => longDate(iso, settings.locale)
  const answer = affordAnswer(asked, plan, money, date, periodWord(settings.period.kind))
  return (
    <div role="status" aria-label="The answer" className="stack-sm">
      <p>
        <b className={answer.tone}>{answer.verdict}</b> {answer.summary}
      </p>
      {answer.reasons.map((reason) => (
        <p key={reason} className="small muted">
          {reason}
        </p>
      ))}
      {answer.when && <p className="small">{answer.when}</p>}
      {answer.saveFor && (
        <div className="row">
          <button
            type="button"
            className="btn primary"
            onClick={() => onSaveFor(goalDraftFor(asked, plan))}
          >
            Save for it
          </button>
        </div>
      )}
    </div>
  )
}

/** The check's form: what it is, and the price. */
function AskForm({ busy, onAsk }: { busy: boolean; onAsk: (asked: Asked) => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const amountCents = parseMoney(price)
  const priceField = useAmountField(price, { min: 0 })
  const ready = amountCents !== null && amountCents > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready) onAsk({ name, amountCents })
  }

  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Can I afford it?">
      <label className="field">
        What is it?
        <input
          className="input"
          placeholder="New bike"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Setting label="Price">
        <input
          className="input num"
          style={{ width: 110 }}
          inputMode="decimal"
          aria-label="Price"
          placeholder="0.00"
          {...priceField.inputProps}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Setting>
      <AmountNote id={priceField.id} text={priceField.shown} />
      <div className="row">
        <button type="submit" className="btn" disabled={!ready || busy}>
          {busy ? 'Checking' : 'Check'}
        </button>
      </div>
    </form>
  )
}

export function AffordCheck({ onSaveFor }: { onSaveFor: (draft: GoalDraft) => void }) {
  // The last thing asked about; the answer always belongs to it, whatever is typed since.
  const [asked, setAsked] = useState<Asked | null>(null)
  const check = useAction(
    'when_can_i_afford',
    asked ? { amountCents: asked.amountCents } : undefined,
    { enabled: asked !== null },
  )
  return (
    <Card static="form" label="Can I afford it?" className="stack-sm">
      <SectionHead icon="tag" title="Can I afford it?" />
      <AskForm busy={check.isFetching} onAsk={setAsked} />
      <ErrorNote error={check.error} />
      {asked && check.data && <Answer asked={asked} plan={check.data} onSaveFor={onSaveFor} />}
    </Card>
  )
}
