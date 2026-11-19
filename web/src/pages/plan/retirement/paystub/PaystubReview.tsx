// The review screen: every figure Claude read from a paystub, each one
// editable, with how sure Claude was and the line it came from, then where
// the figures should go. Nothing is saved until the owner chooses Save.

import { useId, useState, type FormEvent } from 'react'
import type { Input } from '../../../../api/client'
import { ErrorNote } from '../../../../components/ui'
import {
  CADENCE_WORDS,
  CONFIDENCE_WORDS,
  CURRENT_LABELS,
  readReview,
  reviewText,
  showsPlanFigures,
  YEAR_TO_DATE_LABELS,
  type Extraction,
  type PaystubRead,
  type PensionChoice,
  type ReviewText,
} from './review'

type Figure = Extraction['current'][keyof Extraction['current']]

/** How sure Claude was, as a badge; one to check closely stands out. */
function Confidence({ figure }: { figure: Pick<Figure, 'confidence'> }) {
  const low = figure.confidence === 'low'
  return <span className={low ? 'badge warn' : 'badge'}>{CONFIDENCE_WORDS[figure.confidence]}</span>
}

/** One figure: its label, how sure Claude was, the amount to edit, and the line it came from. */
function FigureField({
  label,
  group,
  figure,
  value,
  onChange,
}: {
  label: string
  group: string
  figure: Figure
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const found = figure.cents !== null || figure.source !== null
  return (
    <div className="review-figure">
      <div className="row-between wrap">
        <label htmlFor={id}>{label}</label>
        {found && <Confidence figure={figure} />}
      </div>
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        aria-label={`${group}: ${label}`}
        aria-describedby={figure.source ? `${id}-source` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {figure.source && (
        <small id={`${id}-source`} className="muted">
          From the line &ldquo;{figure.source}&rdquo;
        </small>
      )}
    </div>
  )
}

/**
 * A group of figures: the ones Claude found first, and the rest folded away
 * for the owner to add if Claude missed one, so a phone shows only what matters.
 */
function FigureGroup<F extends string>({
  legend,
  labels,
  figures,
  text,
  onChange,
}: {
  legend: string
  labels: Record<F, string>
  figures: Record<F, Figure>
  text: Record<F, string>
  onChange: (field: F, value: string) => void
}) {
  const fields = Object.keys(labels) as F[]
  const isFound = (field: F) => figures[field].cents !== null || figures[field].source !== null
  const field = (name: F) => (
    <FigureField
      key={name}
      label={labels[name]}
      group={legend}
      figure={figures[name]}
      value={text[name]}
      onChange={(value) => onChange(name, value)}
    />
  )
  const missed = fields.filter((name) => !isFound(name))
  return (
    <fieldset className="review-group">
      <legend>{legend}</legend>
      <div className="review-figures">{fields.filter(isFound).map(field)}</div>
      {missed.length > 0 && (
        <details className="more review-more">
          <summary>Add a figure Claude did not find ({missed.length})</summary>
          <div className="review-figures">{missed.map(field)}</div>
        </details>
      )}
    </fieldset>
  )
}

/** The paystub's own details: who paid, when, for which days, and how often. */
function PaystubDetails({
  extraction,
  text,
  set,
}: {
  extraction: Extraction
  text: ReviewText
  set: (change: Partial<ReviewText>) => void
}) {
  const cadence = extraction.payCadence
  const cadenceId = useId()
  return (
    <div className="review-figures">
      <label className="field">
        Employer
        <input
          className="input"
          maxLength={80}
          value={text.employerName}
          onChange={(e) => set({ employerName: e.target.value })}
        />
      </label>
      <label className="field">
        Pay date
        <input
          className="input"
          type="date"
          value={text.payDate}
          onChange={(e) => set({ payDate: e.target.value })}
        />
      </label>
      <label className="field">
        Period from
        <input
          className="input"
          type="date"
          value={text.periodStart}
          onChange={(e) => set({ periodStart: e.target.value })}
        />
      </label>
      <label className="field">
        Period to
        <input
          className="input"
          type="date"
          value={text.periodEnd}
          onChange={(e) => set({ periodEnd: e.target.value })}
        />
      </label>
      <div className="review-figure">
        <div className="row-between wrap">
          <label htmlFor={cadenceId}>Paid</label>
          {cadence.value !== null && <Confidence figure={cadence} />}
        </div>
        <select
          id={cadenceId}
          className="input"
          value={text.payCadence}
          onChange={(e) => set({ payCadence: e.target.value as ReviewText['payCadence'] })}
        >
          <option value="">Not shown</option>
          {Object.entries(CADENCE_WORDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {cadence.source && (
          <small className="muted">From the line &ldquo;{cadence.source}&rdquo;</small>
        )}
      </div>
    </div>
  )
}

export function PaystubReview({
  read,
  pensions,
  pensionAccountId,
  busy,
  error,
  onSave,
  onCancel,
}: {
  read: PaystubRead
  pensions: PensionChoice[]
  /** The pension chosen to start with, as when opened from that pension's form. */
  pensionAccountId: string | null
  busy: boolean
  error: unknown
  onSave: (input: Input<'save_paystub'>) => void
  onCancel: () => void
}) {
  const { extraction, readerName } = read
  const [text, setText] = useState<ReviewText>(() => reviewText(extraction))
  const [pension, setPension] = useState(pensionAccountId ?? '')
  const [contribution, setContribution] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (change: Partial<ReviewText>) => setText((current) => ({ ...current, ...change }))
  const plans = showsPlanFigures(text)

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = readReview(text)
    setProblem(result.ok ? null : result.error)
    if (!result.ok) return
    onSave({
      paystub: result.paystub,
      pensionAccountId: pension || null,
      setRetirementContribution: plans && contribution,
    })
  }

  return (
    <form className="stack paystub" onSubmit={submit} aria-label="Review the paystub">
      <p className="small">
        {readerName} read these figures. Check each one against your paystub and fix any that are
        wrong; a blank one was not on it. Nothing is saved until you choose Save.
      </p>
      <PaystubDetails extraction={extraction} text={text} set={set} />
      <FigureGroup
        legend="This paycheck"
        labels={CURRENT_LABELS}
        figures={extraction.current}
        text={text.current}
        onChange={(field, value) => set({ current: { ...text.current, [field]: value } })}
      />
      <FigureGroup
        legend="Year to date"
        labels={YEAR_TO_DATE_LABELS}
        figures={extraction.yearToDate}
        text={text.yearToDate}
        onChange={(field, value) => set({ yearToDate: { ...text.yearToDate, [field]: value } })}
      />
      <fieldset className="review-group">
        <legend>Use these figures</legend>
        {pensions.length > 0 && (
          <label className="field">
            Update a pension with its contribution, gross pay, pay schedule and employer share
            <select className="input" value={pension} onChange={(e) => setPension(e.target.value)}>
              <option value="">No, keep the pension as it is</option>
              {pensions.map((choice) => (
                <option key={choice.accountId} value={choice.accountId}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {plans && (
          <label className="row small check check-row">
            <input
              type="checkbox"
              checked={contribution}
              onChange={(e) => setContribution(e.target.checked)}
            />
            Make the 401(k), 457 and 403(b) figures what you add to retirement savings each month
          </label>
        )}
        {pensions.length === 0 && !plans && (
          <p className="small muted">Leeway keeps the figures with your paystubs.</p>
        )}
      </fieldset>
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
