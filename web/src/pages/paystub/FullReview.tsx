// The full paystub review: what the paystub adds up to first, then who paid
// and when, then every line the AI read, grouped as the owner thinks of
// them: pay, taxes, deductions and savings, and what the employer adds.
// Every figure is editable, and nothing is saved until the owner confirms.

import { useState, type FormEvent } from 'react'
import type { Extraction } from '../plan/retirement/paystub/review'
import { PaystubDetails } from '../plan/retirement/paystub/ReviewFields'
import { ErrorNote } from '../../components/ui'
import { PAY_VALUES, type ReviewLine } from '../../../../server/src/domain/paystubs/lines'
import {
  fullText,
  liveDetail,
  readFull,
  type ConfirmedDetail,
  type FullText,
  type LineText,
} from './fullReview'
import { KeyFigures } from './KeyFigures'
import { LINE_LABELS, PAY_LABELS, SECTIONS, type Section } from './labels'
import { ColumnHeads, isFound, LineBlockFields, LineRow, ValueField } from './LineFields'

/** The text of the whole review, and a way to change part of it. */
interface Editing {
  extraction: Extraction
  text: FullText
  setText: (change: (text: FullText) => FullText) => void
}

/** Gross and take-home pay in bold, then hours, rate and salary when the paystub shows them. */
function PayFields({ extraction, text, setText }: Editing) {
  const { pay } = extraction.detail
  const setLine = (name: 'gross' | 'net') => (line: LineText) =>
    setText((current) => ({ ...current, pay: { ...current.pay, [name]: line } }))
  const values = PAY_VALUES.map((name) => (
    <ValueField
      key={name}
      label={PAY_LABELS[name]}
      figure={pay[name]}
      value={text.pay[name]}
      onChange={(value) =>
        setText((current) => ({ ...current, pay: { ...current.pay, [name]: value } }))
      }
    />
  ))
  const shown = PAY_VALUES.some((name) => isFound(pay[name]))
  return (
    <div className="stack-sm">
      <ColumnHeads />
      {(['gross', 'net'] as const).map((name) => (
        <LineRow
          key={name}
          strong
          label={PAY_LABELS[name]}
          context="Pay"
          line={pay[name]}
          text={text.pay[name]}
          onChange={setLine(name)}
        />
      ))}
      {/* Hours and salary matter for some paystubs only, so they fold away when none shows. */}
      {shown ? (
        <div className="review-figures">{values}</div>
      ) : (
        <details className="more review-more">
          <summary>Add hours, an hourly rate or a salary</summary>
          <div className="review-figures">{values}</div>
        </details>
      )}
    </div>
  )
}

/** One section: its heading, and each block of lines under it. */
function SectionFields({
  section,
  readerName,
  extraction,
  text,
  setText,
}: Editing & { section: Section; readerName: string }) {
  return (
    <fieldset className="review-group review-section">
      <legend>{section.title}</legend>
      {section.id === 'pay' && <PayFields extraction={extraction} text={text} setText={setText} />}
      {section.blocks.map(({ group, heading }) => (
        <LineBlockFields
          key={group}
          context={heading ?? section.title}
          heading={heading}
          readerName={readerName}
          labels={LINE_LABELS[group] as Record<string, string>}
          lines={extraction.detail[group] as Record<string, ReviewLine>}
          text={text.groups[group] as Record<string, LineText>}
          onChange={(name, line) =>
            setText((current) => ({
              ...current,
              groups: { ...current.groups, [group]: { ...current.groups[group], [name]: line } },
            }))
          }
        />
      ))}
    </fieldset>
  )
}

export function FullReview({
  extraction,
  readerName,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  extraction: Extraction
  readerName: string
  busy: boolean
  error: unknown
  onConfirm: (detail: ConfirmedDetail) => void
  onCancel: () => void
}) {
  const [text, setText] = useState<FullText>(() => fullText(extraction))
  const [problem, setProblem] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const reviewed = readFull(text)
    if (!reviewed.ok) {
      setProblem(reviewed.error)
      return
    }
    setProblem(null)
    onConfirm(reviewed.detail)
  }

  return (
    <form className="stack paystub" onSubmit={submit} aria-label="Review your paystub">
      <p className="small">
        {readerName} read the lines below. Check them against your paystub and fix any that are
        wrong; a blank one was not on it. Nothing is saved until you choose Confirm.
      </p>
      <KeyFigures detail={liveDetail(text)} />
      <PaystubDetails
        extraction={extraction}
        text={text}
        set={(change) => setText((current) => ({ ...current, ...change }))}
      />
      {SECTIONS.map((section) => (
        <SectionFields
          key={section.id}
          section={section}
          readerName={readerName}
          extraction={extraction}
          text={text}
          setText={setText}
        />
      ))}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy}>
          Confirm
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
