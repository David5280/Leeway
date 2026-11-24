// The goal timeline: one line from today to the goal's date, with a flag on
// the date and a dot where recent progress would get there. Ahead of the flag
// is on track; past it is behind, and drawn in the warning color.

import type { Goal } from '../../api/client'
import { useApp } from '../../lib/app'
import { longDate } from '../../lib/format'
import { useWidth } from '../../lib/useWidth'
import { timelineLayout, type TimelineMark } from './goalTimeline'
import { ChartFrame } from './parts'

/** A label on the top or bottom row. */
function MarkLabel({ mark, y, strong }: { mark: TimelineMark; y: number; strong?: boolean }) {
  return (
    <text
      x={mark.x}
      y={y}
      textAnchor={mark.anchor}
      className={strong ? 'chart-axis strong-label' : 'chart-axis'}
    >
      {mark.label}
    </text>
  )
}

/** What the picture shows, in one sentence for screen readers. */
function describe(goal: Goal, today: string, locale: string): string {
  const parts = [`Today is ${longDate(today, locale)}.`]
  if (goal.targetDate) parts.push(`The goal date is ${longDate(goal.targetDate, locale)}.`)
  parts.push(
    goal.projectedDate
      ? `At the recent pace it is ready ${longDate(goal.projectedDate, locale)}.`
      : 'There is no recent progress to project from.',
  )
  return parts.join(' ')
}

export function GoalTimeline({ goal, today }: { goal: Goal; today: string }) {
  const { settings } = useApp()
  const [measure, width] = useWidth<HTMLDivElement>(480)
  const purchase = goal.kind === 'purchase'
  const layout = timelineLayout(
    { today, targetDate: goal.targetDate, projectedDate: goal.projectedDate },
    {
      target: `${purchase ? 'Buy by' : 'Goal'} ${longDate(goal.targetDate ?? today, settings.locale)}`,
      projected: `At this pace ${longDate(goal.projectedDate ?? today, settings.locale)}`,
    },
    width,
  )
  // Only a goal still being saved for has a pace to place on the line: a stale
  // goal's progress is frozen, and a trip's goal is spent once the trip starts.
  const saving = goal.status === 'in_progress' || goal.status === 'past_due'
  if (!layout || !saving) return null
  const { left, right, lineY, target, projected } = layout
  // Behind means the dot lands past the flag; the line then warns.
  const color = goal.onTrack === false ? 'var(--warn)' : goal.color
  return (
    <ChartFrame
      measure={measure}
      width={width}
      height={layout.height}
      name={`${goal.name} timeline`}
      description={describe(goal, today, settings.locale)}
    >
      <line x1={left} x2={right} y1={lineY} y2={lineY} className="timeline-track" />
      {projected && (
        <line
          x1={left}
          x2={projected.x}
          y1={lineY}
          y2={lineY}
          className="timeline-pace"
          style={{ stroke: color }}
        />
      )}
      <circle cx={left} cy={lineY} r={5} style={{ fill: goal.color }} className="timeline-dot" />
      {layout.today && <MarkLabel mark={layout.today} y={12} />}
      {target && (
        <g>
          <line
            x1={target.x}
            x2={target.x}
            y1={lineY - 12}
            y2={lineY + 6}
            className="timeline-flag"
          />
          <path d={`M${target.x} ${lineY - 12} l9 3.5 l-9 3.5 z`} className="timeline-flag-head" />
          <MarkLabel mark={target} y={12} strong />
        </g>
      )}
      {projected && (
        <g>
          <circle
            cx={projected.x}
            cy={lineY}
            r={5}
            className="timeline-projection"
            style={{ stroke: color }}
          />
          <MarkLabel mark={projected} y={lineY + 24} />
        </g>
      )}
    </ChartFrame>
  )
}
