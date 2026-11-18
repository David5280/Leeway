// Category groups: the headings a long list of categories is shown under.

export interface Grouped<T> {
  /** The heading, or null for items without a group. */
  group: string | null
  items: T[]
}

/**
 * Splits items into groups, keeping their order: groups appear in the order
 * their first item does, and items keep their order within a group. Items
 * without a group come last, so a list mixing both reads headings first.
 */
export function groupBy<T>(items: T[], groupOf: (item: T) => string | null): Grouped<T>[] {
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    const group = groupOf(item)
    const list = groups.get(group)
    if (list) list.push(item)
    else groups.set(group, [item])
  }
  const grouped = [...groups].map(([group, list]) => ({ group, items: list }))
  return [...grouped.filter((g) => g.group !== null), ...grouped.filter((g) => g.group === null)]
}

/** The distinct group names among categories, in order, for suggesting one. */
export function groupNames(categories: { group: string | null }[]): string[] {
  return [...new Set(categories.flatMap((c) => (c.group ? [c.group] : [])))]
}
