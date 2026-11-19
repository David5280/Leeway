// What an agent reads back from a tool. Actions return the same data to the
// owner's web app and to MCP, so the few fields meant only for the owner's own
// screens are dropped here, on the way out to an agent, whichever action
// returned them and however deep they sit.

/**
 * Fields an agent never gets. An account mask is the last digits of an
 * account number: it helps the owner tell two cards apart on screen, gives an
 * assistant nothing to coach with, and should not leave the app.
 */
export const OWNER_ONLY_FIELDS: ReadonlySet<string> = new Set(['mask'])

/** A tool's result as indented JSON for an agent, with every owner-only field left out. */
export function agentJson(result: unknown): string {
  return JSON.stringify(
    result,
    // Returning undefined from a replacer drops that key wherever it appears.
    (key, value: unknown) => (OWNER_ONLY_FIELDS.has(key) ? undefined : value),
    2,
  )
}
