// Alphabetical order for lists a person picks from, like category pickers.
// The budget keeps its own custom order; anything chosen by name reads A to Z.

/**
 * Compares names the way a person reads a list: case and accents are ignored
 * ("apps" sits beside "Apps", "Cafe" beside "Café"), and numbers count by
 * value, so "Rent 2" comes before "Rent 10".
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Compares two names for sorting, A to Z. */
export const compareNames = (a: string, b: string): number => collator.compare(a, b)

/**
 * A copy of the items sorted A to Z by name. The sort is stable, so names that
 * compare equal (like "TV" and "tv") keep the order they came in.
 */
export function sortByName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareNames(nameOf(a), nameOf(b)))
}

/** One heading in a picker and the categories under it. */
export interface CategoryGroup<T> {
  /** The heading, or null for categories without a group. */
  group: string | null
  categories: T[]
}

/**
 * Categories as a picker lists them: groups A to Z, each group's categories
 * A to Z, and categories without a group last, under no heading of their own.
 * With no groups at all, this is one A to Z list (a single null group).
 */
export function alphabeticalGroups<T extends { name: string; group: string | null }>(
  categories: readonly T[],
): CategoryGroup<T>[] {
  const byGroup = new Map<string | null, T[]>()
  for (const category of sortByName(categories, (c) => c.name)) {
    const members = byGroup.get(category.group)
    if (members) members.push(category)
    else byGroup.set(category.group, [category])
  }
  const named = sortByName(
    [...byGroup.keys()].filter((group): group is string => group !== null),
    (group) => group,
  )
  const groups = named.map((group) => ({ group, categories: byGroup.get(group)! }))
  const ungrouped = byGroup.get(null)
  return ungrouped ? [...groups, { group: null, categories: ungrouped }] : groups
}
