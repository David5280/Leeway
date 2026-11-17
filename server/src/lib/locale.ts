// Checking language tags such as "en-US" before they reach Intl formatters.

/**
 * Whether `tag` is a well-formed language tag. A malformed one makes every
 * Intl formatter throw, which would break each screen that shows money or dates.
 */
export function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1
  } catch {
    return false
  }
}
