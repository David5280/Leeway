// The review screen's fields: each figure Claude read with how sure it was
// and the line it came from, grouped with the ones it missed folded away,
// and the paystub's own details. Every one is editable before saving.

import { useId } from 'react'
import { CADENCE_WORDS, CONFIDENCE_WORDS, type Extraction, type ReviewText } from './review'

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
export function FigureGroup<F extends string>({
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
export function PaystubDetails({
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
