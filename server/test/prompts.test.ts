import { describe, expect, it } from 'vitest'
import { COACH_PROMPTS, getPrompt } from '../src/mcp/prompts.js'
import { agentTools } from '../src/mcp/server.js'

/** Sample values for every argument a prompt takes. */
function sampleArgs(prompt: (typeof COACH_PROMPTS)[number]): Record<string, string> {
  return Object.fromEntries((prompt.arguments ?? []).map((a) => [a.name, `sample ${a.name}`]))
}

describe('coaching prompts', () => {
  const toolNames = new Set(agentTools('write').map((tool) => tool.name))

  it.each(COACH_PROMPTS.map((p) => [p.name, p] as const))(
    '%s names only tools an agent can call',
    (_name, prompt) => {
      const text = getPrompt(prompt.name, sampleArgs(prompt)).messages[0]!.content
      if (text.type !== 'text') throw new Error('Prompts are plain text')
      // Tool names are the snake_case words, like get_checkin or update_category.
      const named = text.text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
      expect(named.length).toBeGreaterThan(0)
      for (const tool of named) expect(toolNames).toContain(tool)
    },
  )

  it('has unique names, a title and a description for each', () => {
    const names = COACH_PROMPTS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const prompt of COACH_PROMPTS) {
      expect(prompt.title).toBeTruthy()
      expect(prompt.description).toBeTruthy()
    }
  })
})

describe('save_for', () => {
  const text = (args: Record<string, string>) => {
    const content = getPrompt('save_for', args).messages[0]!.content
    return content.type === 'text' ? content.text : ''
  }

  it('names the item, the price and, when given, when it is wanted', () => {
    expect(text({ item: 'a road bike', amount: '1800', by: ' April ' })).toMatch(
      /^I want to save for a road bike, which costs 1800, by April\. /,
    )
    expect(text({ item: 'a road bike', amount: '1800', by: ' ' })).toMatch(
      /^I want to save for a road bike, which costs 1800\. /,
    )
    expect(text({ item: 'a road bike', amount: '1800' })).toContain('when_can_i_afford')
  })
})
