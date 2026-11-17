// Ready-made coaching conversations an agent's app can offer, like "Money check-in".
// Each is written as the owner's request, naming the tools that answer it.

import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js'
import { AppError } from '../errors.js'

interface CoachPrompt extends Prompt {
  /** The owner's request, filled in with the prompt's arguments. */
  text: (args: Record<string, string>) => string
}

export const COACH_PROMPTS: CoachPrompt[] = [
  {
    name: 'checkin',
    title: 'Money check-in',
    description: 'A short check-in: what needs attention now, and one next step.',
    text: () =>
      'Give me a quick money check-in. Use get_checkin. Lead with anything marked "now", then "soon"; mention "fyi" items only if there is room. Use the real numbers, suggest one concrete next step, and keep it short.',
  },
  {
    name: 'afford',
    title: 'Can I afford this?',
    description: 'Checks a purchase against cash until payday and the budget.',
    arguments: [
      { name: 'item', description: 'What it is, like "new headphones"', required: true },
      { name: 'amount', description: 'What it costs, like "249.99"', required: true },
    ],
    text: ({ item, amount }) =>
      `I'm thinking of buying ${item} for ${amount}. Use can_i_afford, with the category it would fall under if one fits (see list_categories). Tell me plainly whether it fits, why, and what it would leave me per day until payday. If it is tight, suggest when it would fit better.`,
  },
  {
    name: 'debt_plan',
    title: 'Plan my debt payoff',
    description: 'Compares avalanche and snowball, and what paying extra changes.',
    text: () =>
      'Help me pay off my debts. Use plan_debt_payoff. If any debt is missing an interest rate or payment, ask me for it and save it with update_account. Compare avalanche and snowball in months and interest, ask how much extra I could pay each month, and show what that changes.',
  },
  {
    name: 'subscriptions',
    title: 'Review subscriptions',
    description: 'What subscriptions and repeating charges cost, and which to track.',
    text: () =>
      'Review my subscriptions and repeating charges. Use list_bills and find_recurring. Total what subscriptions cost a month and a year, ask which ones I still use, and offer to track any untracked ones as bills. You cannot cancel anything, so tell me where I would cancel.',
  },
  {
    name: 'period_review',
    title: 'Review last period',
    description: 'How the last budget period went, and budget changes to consider.',
    text: () =>
      'Review how my last budget period went. Use get_budget with offset -1, and get_trends for the longer view. Tell me where I stayed on budget, where I went over and by how much, and suggest changes for the next period. Ask me before changing any budget.',
  },
  {
    name: 'set_up_budgets',
    title: 'Set up my budgets',
    description: 'Budgets suggested from real spending, set up with the owner.',
    text: () =>
      'Help me set up budgets from my real spending. Use suggest_budgets, walk me through the suggestions a few at a time, and set the ones I agree to with update_category. Start with the categories I spend the most in.',
  },
]

/** What prompts/list returns: everything but the text builder. */
export function listPrompts(): Prompt[] {
  return COACH_PROMPTS.map(({ text: _text, ...prompt }) => prompt)
}

/** One prompt filled in with its arguments, refusing a missing required one. */
export function getPrompt(name: string, args: Record<string, string> = {}): GetPromptResult {
  const prompt = COACH_PROMPTS.find((p) => p.name === name)
  if (!prompt) throw new AppError('not_found', `Unknown prompt ${name}`)
  for (const argument of prompt.arguments ?? []) {
    if (argument.required && !args[argument.name]?.trim()) {
      throw new AppError('invalid_input', `The ${argument.name} argument is required`)
    }
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }],
  }
}
