// The pace chart's rules, free of React: its axis, what it labels and where
// its plot sits, so each can be read and tested on its own.

import type { Output } from '../../api/client'
import { niceTicks, textWidth } from '../../lib/chartScale'
import { AXIS_FONT } from './parts'

export type Pace = Output<'get_spending_pace'>

/**
 * The value axis for a pace chart. A wild early projection (a big purchase on
 * day one) would flatten everything else, so the axis stops at 1.6 times the
 * larger of budget and spending; the projection line runs off the top instead.
 */
export function paceAxis(budgetCents: number, spentCents: number, projectedCents: number) {
  const base = Math.max(budgetCents, spentCents)
  const projection = base > 0 ? Math.min(projectedCents, base * 1.6) : projectedCents
  // A little headroom so the highest line never sits on the top gridline.
  return niceTicks(0, Math.max(base, projection) * 1.04, 5)
}

/** The steady-pace amount by day `index`: the budget spread evenly over the period. */
export function steadyAt(budgetCents: number, index: number, days: number): number {
  return Math.round((budgetCents * (index + 1)) / Math.max(1, days))
}

/** Where spending stands: the last day with data and whether there is a projection to draw. */
export function paceState(pace: Pace, isCurrent: boolean) {
  const lastIndex = pace.cumulative.length - 1
  return {
    lastIndex,
    spentCents: pace.cumulative.at(-1)?.cents ?? 0,
    // A finished period, or one whose last day has data, has nothing left to project.
    projecting: isCurrent && lastIndex >= 0 && lastIndex < pace.days - 1,
  }
}

export interface EndLabelSpec {
  name: string
  cents: number
  tone: 'muted' | 'accent'
}

/**
 * The labels at the right-hand ends of the lines, in place of a legend: the
 * budget, and either where spending is heading or, for a finished period,
 * where it ended.
 */
export function paceEndLabels(pace: Pace, state: ReturnType<typeof paceState>): EndLabelSpec[] {
  const labels: EndLabelSpec[] = []
  if (pace.budgetCents > 0) labels.push({ name: 'Budget', cents: pace.budgetCents, tone: 'muted' })
  if (state.projecting) {
    labels.push({ name: 'Projected', cents: pace.projectedCents, tone: 'accent' })
  } else if (state.lastIndex >= 0) {
    labels.push({ name: 'Spent', cents: state.spentCents, tone: 'accent' })
  }
  return labels
}

/**
 * The plot's edges inside a chart `width` pixels wide: a gutter on the left
 * for the value labels and one on the right for the line-end labels.
 */
export function paceFrame(width: number, tickLabels: string[], endLabels: string[]) {
  const height = width < 420 ? 210 : 250
  const widest = (labels: string[], size: number) =>
    Math.max(0, ...labels.map((label) => textWidth(label, size)))
  return {
    height,
    left: widest(tickLabels, 12) + 12,
    right: width - Math.max(72, widest(endLabels, 13) + 14),
    // Room above the plot for "Today", and below it for the dates.
    top: 26,
    bottom: height - 30,
  }
}

/** The first and last date labels hug the plot's edges so they never spill past them. */
export function edgeAnchor(index: number, days: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start'
  if (index === days - 1) return 'end'
  return 'middle'
}

export interface Point {
  x: number
  y: number
}

/** A label's room on the chart, edge to edge. */
export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** The size of today's spent amount, drawn beside its dot. */
export const SPENT_FONT = 13

/**
 * Where today's spent amount sits: up and to the left of the dot, clear of the
 * line climbing away to the right, but never past the plot's left edge.
 * `x` is the text's right end, as it is drawn anchored there.
 */
export function spentLabel(at: Point, text: string, left: number): { x: number; box: Box } {
  const width = textWidth(text, SPENT_FONT)
  const x = Math.max(left + width, at.x - 8)
  const baseline = at.y - 12
  return { x, box: { left: x - width, right: x, top: baseline - SPENT_FONT, bottom: baseline + 4 } }
}

/**
 * The corners of a label `width` wide turned `angle` degrees about `at`, its
 * baseline `offset` below that point (negative is above), in drawing order.
 */
export function turnedCorners(
  at: Point,
  width: number,
  font: number,
  angle: number,
  offset: number,
): Point[] {
  const turn = (angle * Math.PI) / 180
  // From the cap height above the baseline to a descender's depth below it.
  const corners = [
    [-width / 2, offset - font],
    [width / 2, offset - font],
    [width / 2, offset + 4],
    [-width / 2, offset + 4],
  ] as const
  return corners.map(([dx, dy]) => ({
    x: at.x + dx * Math.cos(turn) - dy * Math.sin(turn),
    y: at.y + dx * Math.sin(turn) + dy * Math.cos(turn),
  }))
}

/** A box's corners, in drawing order. */
export function boxCorners(box: Box): Point[] {
  return [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ]
}

/**
 * How deeply two convex shapes (corners in drawing order) overlap: the least
 * push along any edge's normal that would part them, and 0 when they are
 * apart. They are apart exactly when some normal has their shadows on it not
 * meeting (the separating axis test); shapes that only touch count as apart.
 */
export function overlapDepth(a: Point[], b: Point[]): number {
  const normals = [a, b].flatMap((shape) =>
    shape.map((corner, i) => {
      const next = shape[(i + 1) % shape.length]!
      return { x: corner.y - next.y, y: next.x - corner.x }
    }),
  )
  let least = Infinity
  for (const axis of normals) {
    // In pixels, so depths along different normals compare (a repeated corner has none).
    const length = Math.hypot(axis.x, axis.y) || 1
    const shadow = (shape: Point[]) =>
      shape.map((corner) => (corner.x * axis.x + corner.y * axis.y) / length)
    const [onA, onB] = [shadow(a), shadow(b)]
    const overlap =
      Math.min(Math.max(...onA), Math.max(...onB)) - Math.max(Math.min(...onA), Math.min(...onB))
    if (overlap <= 0) return 0
    least = Math.min(least, overlap)
  }
  return least
}

/** Whether two convex shapes (corners in drawing order) overlap; touching is apart. */
export function shapesMeet(a: Point[], b: Point[]): boolean {
  return overlapDepth(a, b) > 0
}

/** How far along the steady slope its label sits: two thirds, where spending has usually not reached yet. */
export const STEADY_LABEL_SHARE = 0.66

/** Where the steady pace's label sits: turned along the slope, and whether it moved. */
export interface SteadyLabelSpot {
  at: Point
  /** The baseline's offset from `at`, across the slope. */
  offset: number
  angle: number
  /** Moved off its usual place to keep clear of today's amount. */
  moved: boolean
}

/**
 * The steady pace's label, along the slope on whichever side the projection
 * line is not. A budget so small the slope lies on the floor is labeled above
 * it, clear of the dates. The label moves along the slope only when it would
 * sit on today's amount.
 */
export function steadyLabel({
  label,
  from,
  to,
  left,
  bottom,
  labelBelow,
  avoid,
}: {
  /** The label's words, which set how long it is. */
  label: string
  from: Point
  to: Point
  /** The plot's left edge, which a moved label keeps inside. */
  left: number
  bottom: number
  labelBelow: boolean
  /** Today's dot and the box of its amount, when there is one to keep clear of. */
  avoid?: { today: Point; spent: Box }
}): SteadyLabelSpot {
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  const width = textWidth(label, AXIS_FONT)
  /** The label's turning point a share of the way along the slope, and its baseline's offset from there. */
  const place = (share: number, moved = false, side = labelBelow): SteadyLabelSpot => {
    const at = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }
    const below = side && at.y + AXIS_FONT + 4 <= bottom
    return { at, offset: below ? AXIS_FONT + 4 : -6, angle, moved }
  }
  const usual = place(STEADY_LABEL_SHARE)
  const corners = (spot: SteadyLabelSpot) =>
    turnedCorners(spot.at, width, AXIS_FONT, angle, spot.offset)
  // Only a label that would sit on today's amount moves; every other chart draws as before.
  if (!avoid || !shapesMeet(corners(usual), boxCorners(avoid.spent))) return usual
  return movedSteadyLabel({
    spotAt: (x, across) =>
      place((x - from.x) / (to.x - from.x), true, across ? !labelBelow : labelBelow),
    corners,
    end: to.x,
    left,
    ...avoid,
  })
}

/**
 * Where a steady pace label that would sit on today's amount goes instead:
 * slid up the slope past today and its amount when the room left before the
 * end holds the whole turned label, else back before the amount, never past
 * the plot's left edge; on its usual side of the slope first, then across it.
 * The first of these clear of the amount wins; when none is, the one
 * overlapping it least.
 */
function movedSteadyLabel({
  spotAt,
  corners,
  end,
  left,
  today,
  spent,
}: {
  /** The label with its turning point on the slope at this x, across the slope from its usual side or not. */
  spotAt: (x: number, across: boolean) => SteadyLabelSpot
  corners: (spot: SteadyLabelSpot) => Point[]
  end: number
  left: number
  today: Point
  spent: Box
}): SteadyLabelSpot {
  /** The leftmost and rightmost x of the turned label, which reaches past its turning point. */
  const reach = (spot: SteadyLabelSpot) => {
    const xs = corners(spot).map((corner) => corner.x)
    return { low: Math.min(...xs), high: Math.max(...xs) }
  }
  const pastToday = today.x + (spent.right - spent.left) + 8
  /** The places on one side of the slope: past the amount if the label fits there, then before it. */
  const sideSpots = (across: boolean): SteadyLabelSpot[] => {
    /** The label with its whole turned shape centred between two x's. */
    const centred = (low: number, high: number) => {
      const middle = (low + high) / 2
      const first = reach(spotAt(middle, across))
      return spotAt(middle + middle - (first.low + first.high) / 2, across)
    }
    const { low, high } = reach(spotAt(today.x, across))
    const past = end - pastToday >= high - low ? [centred(pastToday, end)] : []
    const before = centred(left, spent.left - 8)
    // Too long for the room before the amount, it is pushed back inside the plot.
    const over = left - reach(before).low
    return [...past, over > 0 ? spotAt(before.at.x + over, across) : before]
  }
  const spots = [...sideSpots(false), ...sideSpots(true)]
  const amount = boxCorners(spent)
  const depths = spots.map((spot) => overlapDepth(corners(spot), amount))
  return spots[depths.indexOf(Math.min(...depths))]!
}
