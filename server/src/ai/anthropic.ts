// Writes the dashboard summary with Claude, through Anthropic's official SDK.
// Only used when the owner turns it on and sets ANTHROPIC_API_KEY themselves.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { MAX_POINTS, type SummaryFacts, type SummaryText } from '../domain/summaryText.js'
import type { AnthropicConfig } from '../config.js'
import { MINUTE_MS } from '../lib/time.js'
import type { SummaryWriter } from './writer.js'

/** The part of the SDK client this writer uses, so tests can pass a fake. */
export type MessagesClient = Pick<Anthropic, 'messages'>

/** The shape Claude is asked for. Lengths are checked after, in `checked`. */
const outputShape = z.object({
  headline: z.string(),
  points: z.array(z.string()),
})

/** What the dashboard accepts: one short headline and one to four short points. */
const checked = z.object({
  headline: z.string().trim().min(1).max(160),
  points: z.array(z.string().trim().min(1).max(240)).min(1).max(MAX_POINTS),
})

export const SYSTEM_PROMPT = `You write the short summary at the top of a personal budgeting dashboard, for the person whose money it is. They glance at it to learn how their money is doing and whether anything needs them.

Write a headline: one sentence, at most 15 words, on how this budget period is going.
Then write 2 to 4 points, most useful first, each one sentence of at most 20 words.

Use only the facts you are given, and copy amounts and dates exactly as written. Do not guess at causes the facts do not show. Speak to the person as "you", warmly and plainly, like a sharp friend who is good with money. Lead with anything that needs them today. When fixedHeadline is set, use it as the headline word for word, and do not repeat it in the points. When things are fine, say so briefly. The heads-up messages are written for an assistant, so put them in your own words for the person, and never mention tools. Never tell the person to save more or that they are under-saving; when hasDefinedBenefitPension is true, their pension is retirement saving, so never treat low or missing IRA, 401(k) or brokerage contributions as a problem. Do not use dashes as punctuation.`

/** Thinking always runs on this model; low effort keeps a short summary quick and cheap. */
const EFFORT = 'low'
/** Room for the model's thinking as well as the few sentences it returns. */
const MAX_TOKENS = 4000

export class AnthropicSummaryWriter implements SummaryWriter {
  readonly name = 'Claude'
  private readonly client: MessagesClient

  constructor(
    private readonly config: AnthropicConfig,
    // One retry and a minute's wait: the dashboard falls back to Leeway's own words.
    client: MessagesClient = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 1,
      timeout: MINUTE_MS,
    }),
  ) {
    this.client = client
  }

  async write(facts: SummaryFacts): Promise<SummaryText> {
    const response = await this.client.messages.parse({
      model: this.config.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Today's facts, as JSON:\n${JSON.stringify(facts, null, 2)}`,
        },
      ],
      output_config: { effort: EFFORT, format: zodOutputFormat(outputShape) },
    })
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write a summary')
    if (response.stop_reason === 'max_tokens') throw new Error('The summary was cut off')
    const result = checked.safeParse(response.parsed_output)
    if (!result.success) throw new Error('The summary came back in an unexpected shape')
    // An urgent account alert always leads, whatever the model wrote.
    return { ...result.data, headline: facts.fixedHeadline ?? result.data.headline }
  }
}
