// How the dashboard's ordered widget list becomes rows and columns on screen.
//
// A plain grid lines widgets up in rows, so a tall widget beside a short one
// leaves a hole under the short one. Instead the list is cut into bands at
// each full-size widget, and within a band each column stacks on its own:
//
//   full            one widget across the whole width
//   split           wide widgets stack in a main column, half ones in a side column
//   pair            only half widgets: two even columns, filled in turn
//
// A lone wide or half widget has no partner to sit beside, so it spans the
// full width rather than leaving a column empty.

import type { Widget } from './library'

export type Band =
  | { kind: 'full'; widget: Widget }
  | { kind: 'split'; main: Widget[]; side: Widget[] }
  | { kind: 'pair'; columns: [Widget[], Widget[]] }

/** Turns one run of wide and half widgets (no full ones) into bands. */
function arrangeRun(run: Widget[]): Band[] {
  const main = run.filter((w) => w.size === 'wide')
  const side = run.filter((w) => w.size === 'half')
  if (main.length > 0 && side.length > 0) return [{ kind: 'split', main, side }]
  if (run.length === 1 || side.length === 0) {
    // Wide widgets with nothing beside them each take the full width.
    return run.map((widget) => ({ kind: 'full', widget }))
  }
  // Half widgets alone alternate between two even columns, keeping their order.
  const columns: [Widget[], Widget[]] = [[], []]
  side.forEach((widget, i) => columns[i % 2]!.push(widget))
  return [{ kind: 'pair', columns }]
}

/** The bands to draw, top to bottom, for widgets in their saved order. */
export function arrange(widgets: Widget[]): Band[] {
  const bands: Band[] = []
  let run: Widget[] = []
  for (const widget of widgets) {
    if (widget.size !== 'full') {
      run.push(widget)
      continue
    }
    bands.push(...arrangeRun(run), { kind: 'full', widget })
    run = []
  }
  bands.push(...arrangeRun(run))
  return bands
}

/**
 * Which column a widget lands in. Moving a widget past one in another column
 * changes nothing on screen, so moves only count widgets in the same lane:
 * wide with wide, half with half, and full widgets, which every lane crosses.
 */
export function sharesLane(a: Widget, b: Widget): boolean {
  return a.size === b.size || a.size === 'full' || b.size === 'full'
}
