// Alphabetical order as people expect it: case and accents do not matter,
// and numbers inside names sort by value ("Card 2" before "Card 10"). Every
// list of names a person picks from is ordered here.

const collators = new Map<string, Intl.Collator>()

function collator(locale: string): Intl.Collator {
  let found = collators.get(locale)
  if (!found) {
    found = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
    collators.set(locale, found)
  }
  return found
}

/** Compares two names alphabetically for `locale`. */
export function compareNames(a: string, b: string, locale = 'en-US'): number {
  return collator(locale).compare(a, b)
}

/** A copy of `items` in alphabetical order of their names; the input is left as it was. */
export function byName<T extends { name: string }>(items: readonly T[], locale = 'en-US'): T[] {
  return [...items].sort((a, b) => compareNames(a.name, b.name, locale))
}
