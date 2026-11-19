// What an agent reads back from a tool. Actions return the same data to the
// owner's web app and to MCP, so what is meant only for the owner's own
// screens is taken out here, on the way out to an agent, whichever action
// returned it and however deep it sits. That covers an account's mask and the
// same digits inside its name, in name fields and in sentences alike.

/**
 * Fields an agent never gets. An account mask is the last digits of an
 * account number: it helps the owner tell two cards apart on screen, gives an
 * assistant nothing to coach with, and should not leave the app.
 */
export const OWNER_ONLY_FIELDS: ReadonlySet<string> = new Set(['mask'])

/** Fields holding an account's name, which a bank sometimes ends with the account number. */
const NAME_FIELDS = ['name', 'bankName'] as const

/** Words left dangling once an account number is taken out, as in "Checking ending in 4417". */
const NUMBER_LEAD_INS = new Set([
  'ending',
  'in',
  'acct',
  'acct.',
  'account#',
  'no',
  'no.',
  '#',
  '-',
])

/**
 * A name without the account's last digits: the run of digits ending in them,
 * with any masking characters in front ("...4417", "X4417", "(XXXX-4417)"),
 * and the words that only introduced it. A name that was nothing but the
 * number becomes "Account".
 */
export function withoutMaskDigits(name: string, mask: string): string {
  const digits = mask.replace(/\D/g, '')
  // Two digits or more, so a one-digit mask never eats ordinary numbers.
  if (digits.length < 2) return name
  // `digits` holds only digits, so it is safe inside the pattern as it is.
  const run = new RegExp(`[x*•·.…#-]*\\d*${digits}(?!\\d)`, 'gi')
  const stripped = name.replace(run, '')
  if (stripped === name) return name
  // Brackets emptied by the removal, then words that only led into the number.
  const words = stripped
    .replace(/[([{]\s*[)\]}]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 0 && NUMBER_LEAD_INS.has(words.at(-1)!.toLowerCase())) words.pop()
  return words.join(' ') || 'Account'
}

/** An account-like object with its mask's digits taken out of its names. */
function withoutMaskInNames(value: Record<string, unknown>): Record<string, unknown> {
  const { mask } = value
  if (typeof mask !== 'string') return value
  const copy = { ...value }
  for (const field of NAME_FIELDS) {
    const name = copy[field]
    if (typeof name === 'string') copy[field] = withoutMaskDigits(name, mask)
  }
  return copy
}

/** An account's names as stored, with the mask they may repeat. */
export interface MaskedAccount {
  name: string
  bankName: string
  mask: string | null
}

/**
 * Each account name that gives its mask away, mapped to the name without it.
 * Sentences such as a summary's headline or an alert name an account by
 * itself, with no mask beside it, so they are cleaned by these exact names.
 */
export function maskedNameRenames(accounts: MaskedAccount[]): Map<string, string> {
  const renames = new Map<string, string>()
  for (const { name, bankName, mask } of accounts) {
    if (mask === null) continue
    for (const raw of [name, bankName]) {
      const clean = withoutMaskDigits(raw, mask)
      if (clean !== raw) renames.set(raw, clean)
    }
  }
  return renames
}

/** A sentence with every masked account name in it swapped for its clean one, longest first. */
function withRenames(text: string, renames: ReadonlyMap<string, string>): string {
  const longestFirst = [...renames.keys()].sort((a, b) => b.length - a.length)
  return longestFirst.reduce((out, raw) => out.split(raw).join(renames.get(raw)!), text)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A tool's result as indented JSON for an agent, with every owner-only detail
 * left out. `renames` comes from maskedNameRenames over the owner's accounts.
 */
export function agentJson(
  result: unknown,
  renames: ReadonlyMap<string, string> = new Map(),
): string {
  return JSON.stringify(
    result,
    (key, value: unknown) => {
      // Returning undefined from a replacer drops that key wherever it appears.
      if (OWNER_ONLY_FIELDS.has(key)) return undefined
      if (typeof value === 'string' && renames.size > 0) return withRenames(value, renames)
      // An object is handed over before its own keys, so its names are cleaned first.
      return isRecord(value) ? withoutMaskInNames(value) : value
    },
    2,
  )
}
