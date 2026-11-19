// What an agent reads back from a tool. Actions return the same data to the
// owner's web app and to MCP, so what is meant only for the owner's own
// screens is taken out here, on the way out to an agent, whichever action
// returned it and however deep it sits.
//
// Account names need no cleaning here: every sentence and field that names an
// account uses the name worked out in accountName.ts, which never carries the
// account number, so an agent reads the same clean name the owner sees.

/**
 * Fields an agent never gets. An account mask is the last digits of an
 * account number, and the bank's own name for an account sometimes ends with
 * them. Both help the owner match an account to a statement on screen, give
 * an assistant nothing to coach with, and should not leave the app. The
 * clean `name` beside them says which account it is.
 */
export const OWNER_ONLY_FIELDS: ReadonlySet<string> = new Set(['mask', 'bankName'])

/** A tool's result as indented JSON for an agent, with every owner-only field left out. */
export function agentJson(result: unknown): string {
  return JSON.stringify(
    result,
    // Returning undefined from a replacer drops that key wherever it appears.
    (key, value: unknown) => (OWNER_ONLY_FIELDS.has(key) ? undefined : value),
    2,
  )
}
