// The category bars' scale, free of React: every bar on one shared scale so
// they compare at a glance, each with its budget marked as a line, and the
// part past the budget kept apart so it can be drawn as over.

/** What a bar needs: what was spent and the budget, if there is one. */
export interface BarInput {
  spentCents: number
  budgetCents: number | null
}

export interface BarShape {
  /** The spending inside the budget (or all of it, without one), as a percent of the track. */
  within: number
  /** The spending past the budget, as a percent of the track; 0 when not over. */
  over: number
  /** Where the budget line sits, as a percent of the track; null without a budget. */
  limit: number | null
}

/** The amount the whole track stands for: the largest spend or budget shown. */
export function barScale(rows: readonly BarInput[]): number {
  return Math.max(1, ...rows.map((row) => Math.max(row.spentCents, row.budgetCents ?? 0)))
}

/** One bar on a track `scale` cents long. Refunds past spending draw as an empty bar. */
export function barShape(row: BarInput, scale: number): BarShape {
  const percent = (cents: number) => (Math.max(0, cents) / scale) * 100
  const spent = Math.max(0, row.spentCents)
  if (row.budgetCents === null) return { within: percent(spent), over: 0, limit: null }
  const inside = Math.min(spent, row.budgetCents)
  return {
    within: percent(inside),
    over: percent(spent - inside),
    limit: percent(row.budgetCents),
  }
}
