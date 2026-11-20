// The AI services an install has: none without ANTHROPIC_API_KEY, and with
// one, the usage layer and the jobs that pay for calls through it.

import type { Config } from '../config.js'
import type { AppContext } from '../context.js'
import { AiGateway, type GatewayDeps } from '../domain/ai/gateway.js'
import { PaystubReader } from '../domain/paystubs/reader.js'
import { AnthropicProvider } from './anthropic.js'
import { AiDocumentReader } from './paystubs.js'
import { AiSummaryWriter } from './summary.js'

export function aiServices(
  config: Pick<Config, 'anthropic' | 'modelOverrides'>,
  db: GatewayDeps['db'],
  now: () => Date,
  onQuietFailure?: GatewayDeps['onQuietFailure'],
): Pick<AppContext, 'ai' | 'writer' | 'paystubs'> {
  if (!config.anthropic) return { ai: null, writer: null, paystubs: null }
  const ai = new AiGateway(new AnthropicProvider(config.anthropic.apiKey), {
    db,
    now,
    overrides: config.modelOverrides,
    onQuietFailure,
  })
  return {
    ai,
    writer: new AiSummaryWriter(ai),
    paystubs: new PaystubReader(new AiDocumentReader(ai)),
  }
}
