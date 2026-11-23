// The AI summary writer, kept behind an interface like the bank provider, so
// tests use a fake and another model provider could be added without
// touching the rest of the app.

import type { SummaryFacts } from '../domain/summaryFacts.js'
import type { SummaryText } from '../domain/summaryText.js'

export interface SummaryWriter {
  /** Shown in the app as who wrote the summary, like "Claude". */
  name: string
  /** Writes a summary from the facts, or throws; the caller falls back to Leeway's own words. */
  write(facts: SummaryFacts): Promise<SummaryText>
}
