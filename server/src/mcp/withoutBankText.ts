// What a tool returns to an AI assistant, without the bank's own text for any
// transaction. Pure.
//
// The bank's raw description and merchant name can name an account by its
// number ("ONLINE TRANSFER FROM CHK XXXXXX9876"), so they stay in the owner's
// own app, under a transaction's Bank details. An assistant gets the display
// name, which is clean and shows no account number (see safeName.ts).

/** The fields of a transaction that hold the bank's own text. */
const BANK_TEXT_KEYS = ['name', 'merchantName'] as const

/** A transaction as the app presents one: it has a display name beside the bank's text. */
function isTransaction(value: Record<string, unknown>): boolean {
  return typeof value.displayName === 'string' && 'amountCents' in value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The output with the bank's text taken out of every transaction in it, at
 * any depth: in a list, inside an account's view, or as a rule preview's
 * examples. Everything else is returned as it was.
 */
export function withoutBankText(output: unknown): unknown {
  if (Array.isArray(output)) return output.map(withoutBankText)
  // Only plain objects are walked: a Date, say, is left for JSON to write.
  if (!isPlainObject(output)) return output
  const entries = Object.entries(output)
  const transaction = isTransaction(output)
  return Object.fromEntries(
    entries
      .filter(([key]) => !(transaction && (BANK_TEXT_KEYS as readonly string[]).includes(key)))
      .map(([key, value]) => [key, withoutBankText(value)]),
  )
}
