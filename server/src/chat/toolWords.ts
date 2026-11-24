// A tool's description as Chat's model reads it. The read-only tools are
// described for assistants over MCP, which may also hold the tools that
// change things, so some point at them ("call track_recurring with its
// key"). Chat has none of those, and a model told to call a tool it lacks
// wastes a step trying. Pure.

/** A bracketed aside: "(update_settings with retirement saves them)". */
const ASIDE = /\s*\([^()]*\)/g

/** Whether text names any of the tools. */
function namesAny(text: string, tools: readonly RegExp[]): boolean {
  return tools.some((tool) => tool.test(text))
}

/** A sentence without its clauses (split at "; ") that name a tool; empty when none is left. */
function sentenceWithout(sentence: string, tools: readonly RegExp[]): string {
  const clauses = sentence.split('; ')
  const kept = clauses.filter((clause) => !namesAny(clause, tools))
  if (kept.length === clauses.length) return sentence
  if (kept.length === 0) return ''
  const joined = kept.join('; ')
  return /[.!?]$/.test(joined) ? joined : `${joined}.`
}

/**
 * The description without any aside, clause or sentence that names one of
 * `absent`, the tools the reader does not have. Everything else is kept as
 * it was written.
 */
export function withoutAbsentTools(description: string, absent: readonly string[]): string {
  const tools = absent.map((name) => new RegExp(`\\b${name}\\b`))
  if (!namesAny(description, tools)) return description
  const asides = description.replace(ASIDE, (aside) => (namesAny(aside, tools) ? '' : aside))
  return asides
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentenceWithout(sentence, tools))
    .filter(Boolean)
    .join(' ')
}
