// Building blocks for reading a bank line's words at tax time. Pure.

/** A pattern for any of these alternatives as whole words, in any case. */
export const anyOf = (...alternatives: string[]): RegExp =>
  new RegExp(alternatives.map((words) => String.raw`\b(${words})\b`).join('|'), 'i')
