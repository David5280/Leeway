// Alphabetical order for lists a person picks from, like category pickers.
// The budget keeps its own custom order; anything chosen by name reads A to Z,
// in the order of the language set under Settings, Region (its locale), so a
// Swedish list puts "Ö" after "Z" while an English one files it with "O".

/** One collator per locale, made the first time that locale sorts something. */
const collators = new Map<string, Intl.Collator>()

/**
 * Compares names the way a person reads a list: case and accents are ignored
 * where the language does ("apps" sits beside "Apps", "Cafe" beside "Café" in
 * English), and numbers count by value, so "Rent 2" comes before "Rent 10".
 */
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale)
  if (!collator) {
    collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
    collators.set(locale, collator)
  }
  return collator
}

/** Compares two names for sorting, A to Z, in a locale's order. */
export const compareNames = (a: string, b: string, locale: string): number =>
  collatorFor(locale).compare(a, b)

/**
 * A copy of the items sorted A to Z by name. The sort is stable, so names that
 * compare equal (like "TV" and "tv") keep the order they came in.
 */
export function sortByName<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  locale: string,
): T[] {
  return [...items].sort((a, b) => compareNames(nameOf(a), nameOf(b), locale))
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
  locale: string,
): CategoryGroup<T>[] {
  const byGroup = new Map<string | null, T[]>()
  for (const category of sortByName(categories, (c) => c.name, locale)) {
    const members = byGroup.get(category.group)
    if (members) members.push(category)
    else byGroup.set(category.group, [category])
  }
  const named = sortByName(
    [...byGroup.keys()].filter((group): group is string => group !== null),
    (group) => group,
    locale,
  )
  const groups = named.map((group) => ({ group, categories: byGroup.get(group)! }))
  const ungrouped = byGroup.get(null)
  return ungrouped ? [...groups, { group: null, categories: ungrouped }] : groups
}
