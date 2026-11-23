// The rows of the full review: each paystub line with its two amounts, this
// paycheck and the year to date, how sure the reader was when it is worth a
// second look, and the line it came from. Lines the reader did not find fold
// away, so a phone shows only what is on the paystub.

import { useId } from 'react'
import type {
  Confidence,
  ReviewLine,
  ReviewValue,
} from '../../../../server/src/domain/paystubs/lines'
import { CONFIDENCE_WORDS } from '../plan/retirement/paystub/review'
import type { LineText } from './fullReview'

/** A badge only for a figure worth a second look; one read clearly needs no word. */
function Check({ confidence }: { confidence: Confidence }) {
  if (confidence === 'high') return null
  const low = confidence === 'low'
  return <span className={low ? 'badge warn' : 'badge'}>{CONFIDENCE_WORDS[confidence]}</span>
}

/**
 * Whether the reader found a figure: an amount, the line it would have come
 * from, or a low mark. An amount printed but unreadable is low with nothing
 * else to show (after-tax "other" never shows its line), and must stay in
 * view with its flag rather than fold away as a line not found.
 */
export function isFound(figure: ReviewLine | ReviewValue): boolean {
  if (figure.source !== null || figure.confidence === 'low') return true
  return 'value' in figure
    ? figure.value !== null
    : figure.current !== null || figure.yearToDate !== null
}

/** The line a figure came from, read with its inputs by a screen reader. */
function Source({ id, source }: { id: string; source: string | null }) {
  if (!source) return null
  return (
    <small id={id} className="muted">
      From the line &ldquo;{source}&rdquo;
    </small>
  )
}

/** The two column names, once above a block of lines, lined up with the inputs. */
export function ColumnHeads() {
  return (
    <div className="review-line review-heads" aria-hidden="true">
      <span className="review-line-name" />
      <span>This paycheck</span>
      <span>Year to date</span>
    </div>
  )
}

/** One line: its name, its two amounts to edit, and where it came from. */
export function LineRow({
  label,
  context,
  line,
  text,
  onChange,
  strong = false,
}: {
  label: string
  /** The heading it sits under, so "HSA" before tax and from the employer read apart. */
  context: string
  line: ReviewLine
  text: LineText
  onChange: (text: LineText) => void
  /** A key figure, like gross pay, drawn bold. */
  strong?: boolean
}) {
  const id = useId()
  const describedBy = line.source ? `${id}-source` : undefined
  return (
    <div className="review-line">
      <div className="review-line-name">
        <span className={strong ? 'strong' : undefined}>{label}</span>
        {isFound(line) && <Check confidence={line.confidence} />}
      </div>
      <input
        className="input num"
        inputMode="decimal"
        aria-label={`${context}: ${label}, this paycheck`}
        aria-describedby={describedBy}
        value={text.current}
        onChange={(e) => onChange({ ...text, current: e.target.value })}
      />
      <input
        className="input num"
        inputMode="decimal"
        aria-label={`${context}: ${label}, year to date`}
        aria-describedby={describedBy}
        value={text.yearToDate}
        onChange={(e) => onChange({ ...text, yearToDate: e.target.value })}
      />
      <Source id={`${id}-source`} source={line.source} />
    </div>
  )
}

/** A single figure that is not a pair of amounts, like hours or a yearly salary. */
export function ValueField({
  label,
  figure,
  value,
  onChange,
}: {
  label: string
  figure: ReviewValue
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="review-figure">
      <div className="row-between wrap">
        <label htmlFor={id}>{label}</label>
        {isFound(figure) && <Check confidence={figure.confidence} />}
      </div>
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        aria-describedby={figure.source ? `${id}-source` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Source id={`${id}-source`} source={figure.source} />
    </div>
  )
}

/**
 * A block of lines under one heading: the ones the reader found first, the
 * rest folded away for the owner to add if the reader missed one.
 */
export function LineBlockFields<L extends string>({
  context,
  heading,
  readerName,
  labels,
  lines,
  text,
  onChange,
}: {
  context: string
  heading?: string
  /** Who read the paystub, named as the rest of the review names it. */
  readerName: string
  labels: Record<L, string>
  lines: Record<L, ReviewLine>
  text: Record<L, LineText>
  onChange: (line: L, text: LineText) => void
}) {
  const names = Object.keys(labels) as L[]
  const found = names.filter((name) => isFound(lines[name]))
  const missed = names.filter((name) => !isFound(lines[name]))
  const row = (name: L) => (
    <LineRow
      key={name}
      label={labels[name]}
      context={context}
      line={lines[name]}
      text={text[name]}
      onChange={(changed) => onChange(name, changed)}
    />
  )
  return (
    <div className="stack-sm">
      {heading && <h3 className="review-subhead">{heading}</h3>}
      {found.length > 0 && (
        <>
          <ColumnHeads />
          {found.map(row)}
        </>
      )}
      {found.length === 0 && <p className="small muted">{readerName} found none of these.</p>}
      {missed.length > 0 && (
        <details className="more review-more">
          <summary>
            Add a line {readerName} did not find ({missed.length})
          </summary>
          <div className="stack-sm">
            <ColumnHeads />
            {missed.map(row)}
          </div>
        </details>
      )}
    </div>
  )
}
