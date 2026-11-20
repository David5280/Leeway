// What a tool hands the chat model: what an assistant over MCP reads (no
// bank text, no account masks or file names; see mcp/), and on top of that,
// no person's name from a payment between people. The owner's chat goes to
// Anthropic, and the people they pay never chose that. Pure.

import { agentJson } from '../mcp/agentOutput.js'
import { withoutBankText } from '../mcp/withoutBankText.js'

/** Stands in for a person's name wherever one would show. */
export const SOMEONE = 'someone'

/** The name as a whole word, in any case: not inside a longer word, accented letters included. */
function wholeName(name: string): RegExp {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'giu')
}

/** A payment between people (transfers.ts), with the other person's name taken out. */
function withoutPeople(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPeople)
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  const entries = Object.entries(value).map(([key, field]) =>
    key === 'counterparty' ? [key, null] : [key, withoutPeople(field)],
  )
  return Object.fromEntries(entries)
}

/**
 * A tool's result as JSON for the chat model. Every name in `people` is
 * replaced wherever it appears, the display name "From Jane Doe" included,
 * longest first so "Jane Doe" goes before a "Jane" on its own.
 */
export function chatToolText(result: unknown, people: readonly string[]): string {
  let text = agentJson(withoutPeople(withoutBankText(result)))
  const longestFirst = [...people].filter((name) => name.trim()).sort((a, b) => b.length - a.length)
  for (const name of longestFirst) text = text.replace(wholeName(name), SOMEONE)
  return text
}
