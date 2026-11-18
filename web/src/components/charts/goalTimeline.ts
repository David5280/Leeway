// Pure layout for the goal timeline: today on the left, the goal's date as a
// flag, and where recent progress lands as a dot, all on one line of days.
// Kept free of React so every placement rule can be tested on its own.

import { dayNumber, textWidth } from '../../lib/chartScale'
import { AXIS_FONT } from './parts'

export interface TimelineDates {
  today: string
  targetDate: string | null
  projectedDate: string | null
}

export type Anchor = 'start' | 'middle' | 'end'

export interface TimelineMark {
  x: number
  label: string
  anchor: Anchor
}

export interface TimelineLayout {
  height: number
  /** The line runs from left to right; today sits at left. */
  left: number
  right: number
  /** The line's height, with the flag's label above and the dot's below. */
  lineY: number
  today: TimelineMark | null
  target: TimelineMark | null
  projected: TimelineMark | null
}

/** Room past the last mark, as a share of the span, so it never sits on the edge. */
const END_ROOM = 0.06
/** Space kept clear between two labels on the same row. */
const LABEL_GAP = 12

/** How to anchor a label centered on x so it stays inside 0..width. */
export function anchorFor(x: number, labelWidth: number, width: number): Anchor {
  if (x - labelWidth / 2 < 0) return 'start'
  if (x + labelWidth / 2 > width) return 'end'
  return 'middle'
}

/** Where a label anchored at x starts and ends, for collision checks. */
function extent(mark: TimelineMark): [number, number] {
  const w = textWidth(mark.label, AXIS_FONT)
  if (mark.anchor === 'start') return [mark.x, mark.x + w]
  if (mark.anchor === 'end') return [mark.x - w, mark.x]
  return [mark.x - w / 2, mark.x + w / 2]
}

/**
 * Places the marks for a width, or returns null when there is nothing ahead
 * to draw: no date and no projection, or only dates already gone.
 */
export function timelineLayout(
  dates: TimelineDates,
  labels: { target: string; projected: string },
  width: number,
): TimelineLayout | null {
  const start = dayNumber(dates.today)
  const ahead = [dates.targetDate, dates.projectedDate]
    .filter((d): d is string => d !== null && d > dates.today)
    .map(dayNumber)
  if (ahead.length === 0) return null
  const span = (Math.max(...ahead) - start) * (1 + END_ROOM)
  const left = 6
  const right = width - 6
  const x = (iso: string) => left + ((right - left) * (dayNumber(iso) - start)) / span
  const mark = (iso: string | null, label: string): TimelineMark | null => {
    if (!iso || iso <= dates.today) return null
    const at = x(iso)
    return { x: at, label, anchor: anchorFor(at, textWidth(label, AXIS_FONT), width) }
  }
  const target = mark(dates.targetDate, labels.target)
  const projected = mark(dates.projectedDate, labels.projected)
  // "Today" shares the top row with the flag's label; it gives way if they would touch.
  let today: TimelineMark | null = { x: left, label: 'Today', anchor: 'start' }
  if (target && extent(target)[0] < extent(today)[1] + LABEL_GAP) today = null
  return { height: 58, left, right, lineY: 29, today, target, projected }
}
