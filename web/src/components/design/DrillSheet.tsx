// Draws a drill-down (lib/drill.ts) in a sheet: a bottom sheet on a phone, a
// side panel on a wider screen. The sections always come in the same order
// and a missing one is left out, so every figure explains itself the same way.

import { Link } from 'react-router-dom'
import { useApp } from '../../lib/app'
import {
  compareToUsual,
  MATH_OPS,
  mathSentence,
  trendDescription,
  usualSentence,
  type DrillDown,
  type DrillItem,
  type DrillMath,
  type DrillTrend,
  type DrillUsual,
  type DrillValue,
  type MathOp,
} from '../../lib/drill'
import { LineChart } from '../charts/LineChart'
import { Icon } from '../ui'
import { CategoryIcon } from './CategoryIcon'
import { Money } from './Money'
import { Sheet } from './Sheet'

export function DrillSheet({ drill, onClose }: { drill: DrillDown; onClose: () => void }) {
  return (
    <Sheet title={drill.title} subtitle={drill.subtitle} onClose={onClose}>
      <div className="drill">
        <div className="drill-figure">
          <Value value={drill.figure} size="xl" />
        </div>
        <MathSection math={drill.math} />
        {drill.trend && drill.trend.points.length > 1 && <TrendSection trend={drill.trend} />}
        {drill.usual && <UsualSection usual={drill.usual} />}
        {drill.items && drill.items.rows.length > 0 && (
          <section className="sheet-section" aria-label={drill.items.title}>
            <h3 className="sheet-section-title">{drill.items.title}</h3>
            <ul className="drill-items">
              {drill.items.rows.map((item) => (
                <li key={item.key}>
                  <ItemRow item={item} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {drill.more && (
          <Link to={drill.more.to} className="btn primary drill-more">
            {drill.more.label}
            <Icon name="forward" size={16} />
          </Link>
        )}
      </div>
    </Sheet>
  )
}

/** How the figure moved, with where it should be as a dashed level when there is one. */
function TrendSection({ trend }: { trend: DrillTrend }) {
  const { money } = useApp()
  return (
    <section className="sheet-section" aria-label="Trend">
      <h3 className="sheet-section-title">{trend.label}</h3>
      <LineChart
        points={trend.points}
        label={trend.label}
        description={trendDescription(trend, money)}
        reference={trend.reference}
      />
    </section>
  )
}

/** A drill-down value: money through <Money>, anything else as words. */
function Value({ value, size }: { value: DrillValue; size?: 'md' | 'lg' | 'xl' }) {
  if ('text' in value) {
    return (
      <span className={`money money-${value.tone ?? 'neutral'} money-${size ?? 'md'}`}>
        {value.text}
      </span>
    )
  }
  return <Money cents={value.cents} sign={value.sign} tone={value.tone} size={size} />
}

/** The math as an equation, one term a line, with the plain sentence read out. */
function MathSection({ math }: { math: DrillMath }) {
  const { money } = useApp()
  return (
    <section className="sheet-section" aria-label="How it adds up">
      <h3 className="sheet-section-title">How it adds up</h3>
      <p className="visually-hidden">{mathSentence(math, money)}</p>
      <dl className="drill-math" aria-hidden="true">
        {math.terms.map((term, index) => (
          <div key={`${term.label}-${index}`} className="drill-math-row">
            <dt>
              <span className="drill-op">{operator(term.op, index)}</span>
              {term.label}
            </dt>
            <dd>
              <Value value={term.value} />
            </dd>
          </div>
        ))}
        <div className="drill-math-row drill-math-result">
          <dt>
            <span className="drill-op">=</span>
            {math.result.label}
          </dt>
          <dd>
            <Value value={math.result.value} size="lg" />
          </dd>
        </div>
      </dl>
      {math.note && <p className="small muted">{math.note}</p>}
    </section>
  )
}

/** The sign before a term: none for the first, else its operation's. */
function operator(op: MathOp | undefined, index: number): string {
  if (index === 0 || !op) return ''
  return MATH_OPS[op].sign
}

/** The figure against its usual: an arrow, the words and a tone, never color alone. */
function UsualSection({ usual }: { usual: DrillUsual }) {
  const { money } = useApp()
  const comparison = compareToUsual(usual)
  const heading = usual.heading ?? 'Compared with usual'
  return (
    <section className="sheet-section" aria-label={heading}>
      <h3 className="sheet-section-title">{heading}</h3>
      <p className={`drill-usual drill-usual-${comparison.tone}`}>
        <span className="drill-usual-arrow" aria-hidden="true">
          {comparison.arrow}
        </span>
        {usualSentence(usual, money)}
      </p>
    </section>
  )
}

/** One part of the figure: a link when it has a page, else a plain row. */
function ItemRow({ item }: { item: DrillItem }) {
  const body = (
    <>
      {item.icon && (
        <CategoryIcon category={item.icon.category} transfer={item.icon.transfer} size="sm" />
      )}
      <span className="drill-item-text">
        <span className="drill-item-label">{item.label}</span>
        {item.detail && <span className="drill-item-detail">{item.detail}</span>}
      </span>
      {item.value && <Value value={item.value} />}
    </>
  )
  if (!item.to) return <div className="drill-item">{body}</div>
  return (
    <Link to={item.to} className="drill-item drill-item-link">
      {body}
    </Link>
  )
}
