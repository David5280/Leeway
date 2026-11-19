// The retirement question and its answer, the range of savings by age, the
// monthly income it could give, and the note that it is no promise. The
// words come worked out from the server (project_retirement); this only lays
// them out.

import { middleFigure, range } from '../../../../../server/src/domain/profile/rangeWords'
import { BandChart } from '../../../components/charts/BandChart'
import { Card, Progress } from '../../../components/ui'
import type { RetirementView } from './fields'
import { Amount, useMoney } from './money'

type Meter = RetirementView['lens']['meters'][number]

/**
 * One meter: its question, the figure and the sentence under it. Once there is
 * a projection, the savings and income meters always carry a figure.
 */
function MeterTile({ meter }: { meter: Meter }) {
  return (
    <div className="span-6 stack-sm" role="group" aria-label={meter.question}>
      <span className="eyebrow">{meter.question}</span>
      <span className="mid-number num range">{meter.headline}</span>
      <span className="small muted">{meter.detail}</span>
      {meter.parts.length > 0 && (
        <ul className="plain-list small">
          {meter.parts.map((part) => (
            <li key={part.label} className="row-between">
              <span>{part.label}</span>
              <span>
                <Amount cents={part.cents} flow="in" /> / mo
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The chart of savings by age, described in words for a screen reader. */
function SavingsBand({ meter }: { meter: Meter }) {
  const money = useMoney()
  const first = meter.band[0]!
  const last = meter.band.at(-1)!
  // The middle case is named only when the ends differ, so one figure is never said twice.
  const middle = middleFigure(last, money)
  const inMiddle = middle === null ? '' : `, ${middle} in the middle case`
  const description = `Savings at ${first.age}: ${money(first.mid)}. At ${last.age}: ${range(last, money)}${inMiddle}.`
  return (
    <div className="stack-sm">
      <BandChart points={meter.band} label="Savings by age" description={description} />
      {/* A key to the drawing, which shows a range rather than one promised line. */}
      <p className="small muted">Shaded: the low to high case. Line: the middle case.</p>
    </div>
  )
}

export function ProjectionCard({ view }: { view: RetirementView }) {
  const { lens, plan } = view
  const { answer } = lens
  const banded = lens.meters.find((meter) => meter.band.length > 1)
  // Bank transfers miss payroll saving such as a pension, so that meter stays on
  // the Savings screen and this card speaks only of what the projection counts.
  const shown = lens.meters.filter((meter) => meter.id !== 'contributions')
  return (
    <Card label="Retirement projection" className="stack">
      <span className="eyebrow">{lens.question}</span>
      {answer.headline && <span className="mid-number num range">{answer.headline}</span>}
      <p className={answer.headline ? 'small' : ''}>{answer.detail}</p>
      {answer.progress && (
        <Progress
          aria-label="Share of the income you want"
          percent={(answer.progress.value / answer.progress.target) * 100}
          color={answer.tone === 'good' ? 'var(--good)' : 'var(--accent)'}
        />
      )}
      {banded && <SavingsBand meter={banded} />}
      {plan.projection && (
        <div className="grid">
          {shown.map((meter) => (
            <MeterTile key={meter.id} meter={meter} />
          ))}
        </div>
      )}
      {lens.insight && <p className="notice">{lens.insight.text}</p>}
      <p className="small muted">{plan.note}</p>
    </Card>
  )
}
