// Merchant totals and repeating series shown by the same label, merged into
// one row (toolOutput.ts), so a model sees one "Transfer to another account"
// and never how many people stand behind it. Pure.

type Row = Record<string, unknown>
type Labelled = Row & { modelLabel: string }

/** Whether an item is a total or series the domain labelled (insights.ts, recurring.ts). */
function isLabelled(item: unknown): item is Labelled {
  return typeof item === 'object' && item !== null && typeof (item as Row).modelLabel === 'string'
}

/** What rows must share to be merged: their label, and a series' direction and cadence. */
function groupOf(row: Labelled): string {
  return [row.modelLabel, row.direction, row.cadence].join('\n')
}

// Amounts and counts that add up when two rows become one.
const SUMMED = ['spentCents', 'count', 'typicalAmountCents'] as const

/** Two dates, earliest first (YYYY-MM-DD sorts as it reads). */
const inOrder = (a: unknown, b: unknown) => [String(a), String(b)].sort()

/** Two rows of one label as one: amounts added, the next date soonest, the last date latest. */
function merged(a: Labelled, b: Labelled): Labelled {
  const sums = SUMMED.filter((field) => typeof a[field] === 'number').map((field) => [
    field,
    (a[field] as number) + Number(b[field]),
  ])
  return {
    ...a,
    ...Object.fromEntries(sums),
    ...('amountVaries' in a ? { amountVaries: true } : {}),
    ...('nextDate' in a ? { nextDate: inOrder(a.nextDate, b.nextDate)[0] } : {}),
    ...('lastDate' in a ? { lastDate: inOrder(a.lastDate, b.lastDate)[1] } : {}),
  }
}

/** Biggest spending first, as top_merchants lists it, when the items are merchant totals. */
function bySpending(items: unknown[]): unknown[] {
  const spent = (item: unknown) => (item as Row).spentCents
  if (!items.every((item) => typeof spent(item) === 'number')) return items
  return [...items].sort((a, b) => (spent(b) as number) - (spent(a) as number))
}

/**
 * A list with every row of one label merged into the first of them and the
 * label field dropped (the row's names already read as it). A list without
 * labelled rows comes back as it was.
 */
export function mergedByLabel(items: unknown[]): unknown[] {
  if (!items.some(isLabelled)) return items
  const kept: unknown[] = []
  const at = new Map<string, number>()
  let mergedAny = false
  for (const item of items) {
    const index = isLabelled(item) ? at.get(groupOf(item)) : undefined
    if (index !== undefined) {
      kept[index] = merged(kept[index] as Labelled, item as Labelled)
      mergedAny = true
      continue
    }
    if (isLabelled(item)) at.set(groupOf(item), kept.length)
    kept.push(item)
  }
  const shown = kept.map((item) => {
    if (!isLabelled(item)) return item
    const { modelLabel: _label, ...rest } = item
    return rest
  })
  return mergedAny ? bySpending(shown) : shown
}
