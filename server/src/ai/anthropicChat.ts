// A conversation step as Anthropic's Messages API takes it, and its reply in
// the provider's own words. Pure: AnthropicProvider sends what this builds.
//
// Prompt caching is on here, unlike the one-off jobs: a question in Chat makes
// a few calls a few seconds apart, each sending the same tools, instructions
// and growing history. The tools and fixed instructions are marked as one
// cached block, and the request's own breakpoint caches the history up to its
// last message, so each later call of the question reads the earlier ones from
// the cache at a tenth of the input price.

import type Anthropic from '@anthropic-ai/sdk'
import type {
  AiChatReply,
  AiChatRequest,
  AiChatStop,
  AiMessage,
  AiToolCall,
  TokenUsage,
} from './provider.js'

const CACHED = { type: 'ephemeral' } as const

/** One message as the Messages API takes it. */
function messageParam(message: AiMessage): Anthropic.MessageParam {
  if (message.role === 'tool_results') {
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError,
      })),
    }
  }
  if ('turn' in message) {
    // Passed back exactly as Claude sent it, thinking included.
    return { role: 'assistant', content: message.turn as Anthropic.ContentBlockParam[] }
  }
  return { role: message.role, content: message.text }
}

/**
 * The request for one step. The tools come first and the fixed instructions
 * after them, marked for the cache; the day's context follows the mark, so a
 * new day changes nothing that is cached.
 */
export function chatParams(request: AiChatRequest) {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: [
      { type: 'text', text: request.system, cache_control: CACHED },
      { type: 'text', text: request.context },
    ],
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    })),
    messages: request.messages.map(messageParam),
    // Caches the history up to the last message, for the next step to read.
    cache_control: CACHED,
    output_config: { effort: request.effort },
  } satisfies Anthropic.MessageCreateParamsNonStreaming
}

function stopOf(reason: Anthropic.StopReason | null): AiChatStop {
  if (reason === 'tool_use') return 'tools'
  if (reason === 'refusal') return 'refused'
  if (reason === 'max_tokens') return 'cut_off'
  return 'done'
}

export function usageOf(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

/** Claude's reply to one step, in the provider's own words. */
export function chatReplyOf(message: Anthropic.Message): AiChatReply {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
  const toolCalls = message.content.flatMap((block): AiToolCall[] =>
    block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
  )
  return {
    stop: stopOf(message.stop_reason),
    text,
    toolCalls,
    turn: message.content,
    usage: usageOf(message.usage),
  }
}
