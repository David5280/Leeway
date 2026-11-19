// Remembers, on this device only, the Settings group opened last, so the
// Settings tab opens where the owner left off. Storage can be off or full
// (private browsing, a locked-down browser); then Settings opens the first group.

const KEY = 'leeway.settings.group'

/** The group this device opened last, or null when none is stored or storage is off. */
export function rememberedGroup(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberGroup(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Not remembering only means the first group opens next time.
  }
}
