// Answering a question in Chat: the steps it takes with tools, what is
// streamed and kept, what reaches the model, and every way a question is
// turned away or ends early. Every call goes to a fake provider.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAction } from '../src/actions/action.js'
import { canIAffordAction, whenCanIAffordAction } from '../src/actions/coach.js'
import { AiProviderError, type AiMessage } from '../src/ai/provider.js'
import { clearChatAction, getChatAction } from '../src/actions/chat.js'
import { CUT_OFF, DECLINED, TOO_MANY_STEPS } from '../src/chat/answer.js'
import { CHAT_SYSTEM } from '../src/chat/prompt.js'
import { CHAT_TOOLS } from '../src/chat/tools.js'
import { MAX_STEPS, openTurn, type ChatEvent } from '../src/chat/turn.js'
import { CHAT_DAILY_TOKENS } from '../src/domain/chat/allowance.js'
import { isAnswering } from '../src/domain/chat/answering.js'
import {
  listFacts,
  listMessages,
  MESSAGE_MAX_LENGTH,
  saveExchange,
  saveFact,
} from '../src/domain/chat/store.js'
import { getSettings, saveSettings } from '../src/domain/settings.js'
import { AppError } from '../src/errors.js'
import type { FakeProvider } from './fixtures/ai.js'
import { calls, gatewayFor, says } from './fixtures/ai.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
let provider: FakeProvider
let logged: unknown[]

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  const gateway = gatewayFor(ctx)
  ctx.ai = gateway.ai
  provider = gateway.provider
  logged = []
})

/** Asks a question and waits for the whole answer, returning every event. */
async function ask(question: string): Promise<ChatEvent[]> {
  const turn = await openTurn(ctx, question, (error) => logged.push(error))
  const events: ChatEvent[] = []
  await turn.run((event) => events.push(event))
  return events
}

/** Asks a question that must be refused before anything is sent, returning the refusal. */
async function refused(question: string): Promise<AppError> {
  const error: unknown = await openTurn(ctx, question, () => {}).then(
    () => null,
    (failure: unknown) => failure,
  )
  expect(error).toBeInstanceOf(AppError)
  return error as AppError
}

const streamed = (events: ChatEvent[]) =>
  events.flatMap((event) => (event.type === 'text' ? [event.text] : [])).join('')
const lastOf = (events: ChatEvent[]) => events.at(-1)!
/** The tool results the model was sent in the step after `step`. */
function toolResults(step: number) {
  const message = provider.conversed[step + 1]!.messages.at(-1)!
  if (message.role !== 'tool_results') throw new Error('No tool results were sent')
  return message.results
}

describe('answering a question', () => {
  it('streams the answer as it is written and keeps the question with it', async () => {
    provider.steps = [says('You have $420 to spend until payday.')]
    const events = await ask('  What can I spend until payday?  ')

    expect(streamed(events)).toBe('You have $420 to spend until payday.')
    // The words came in pieces, before the answer was done.
    expect(events.filter((event) => event.type === 'text').length).toBe(2)
    expect(lastOf(events)).toMatchObject({
      type: 'done',
      question: { role: 'user', text: 'What can I spend until payday?' },
      answer: { role: 'assistant', text: 'You have $420 to spend until payday.' },
    })
    const kept = await listMessages(ctx.db)
    expect(kept.map(({ role, text }) => [role, text])).toEqual([
      ['user', 'What can I spend until payday?'],
      ['assistant', 'You have $420 to spend until payday.'],
    ])
    // The call is paid for under the chat job.
    const { rows } = await ctx.db.query('SELECT job, model FROM ai_usage')
    expect(rows).toEqual([{ job: 'chat', model: 'claude-haiku-5-5' }])
  })

  it('sends the fixed instructions, the day, what to remember and the past conversation', async () => {
    await saveFact(ctx.db, 'Saving for a wedding in June 2027', ctx.now())
    await saveExchange(ctx.db, 'Am I on track?', 'Yes, $300 under budget.', ctx.now())
    await ask('And next month?')

    const sent = provider.conversed[0]!
    expect(sent.model).toBe('claude-haiku-5-5')
    expect(sent.effort).toBe('low')
    expect(sent.system).toBe(CHAT_SYSTEM)
    expect(sent.context).toContain('Today is Tuesday, 2026-11-17.')
    expect(sent.context).toContain("The owner's currency is USD.")
    expect(sent.context).toContain('"Saving for a wedding in June 2027" (saved 2026-11-17)')
    expect(sent.messages).toEqual<AiMessage[]>([
      { role: 'user', text: 'Am I on track?' },
      { role: 'assistant', text: 'Yes, $300 under budget.' },
      { role: 'user', text: 'And next month?' },
    ])
    expect(sent.tools.map((tool) => tool.name)).toEqual(CHAT_TOOLS.map((tool) => tool.name))
  })

  it('uses the model the owner picked for Chat', async () => {
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, {
      ...settings,
      ai: { ...settings.ai, models: { ...settings.ai.models, chat: 'claude-sonnet-5-5' } },
    })
    await ask('How am I doing?')
    expect(provider.conversed[0]!.model).toBe('claude-sonnet-5-5')
  })

  it('looks at the data with tools, saying what it looks at, then answers', async () => {
    provider.steps = [
      calls([{ id: 'call-1', name: 'get_budget', input: {} }], 'Let me look.'),
      says('Your budget has room.'),
    ]
    const events = await ask('How is my budget?')

    expect(events).toContainEqual({ type: 'tool', title: 'Get the budget' })
    expect(provider.conversed).toHaveLength(2)
    // The second step carries the first step's reply back as it came, then the results.
    const second = provider.conversed[1]!.messages
    expect(second.at(-2)).toEqual({
      role: 'assistant',
      turn: [{ type: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'get_budget', input: {} }] }],
    })
    const [result] = toolResults(0)
    expect(result).toMatchObject({ id: 'call-1', isError: false })
    expect(JSON.parse(result!.content)).toHaveProperty('period')
    // What was streamed is what was kept, a paragraph between the steps.
    expect(streamed(events)).toBe('Let me look.\n\nYour budget has room.')
    expect(lastOf(events)).toMatchObject({
      type: 'done',
      answer: { text: 'Let me look.\n\nYour budget has room.' },
    })
  })

  it('answers a purchase through check_purchase, from the two checks Leeway has', async () => {
    await insertBankAccount(ctx.db, { name: 'Checking', balanceCents: 250_000 })
    const input = { amountCents: 69_999 }
    provider.steps = [
      calls([{ id: 'ps5', name: 'check_purchase', input }]),
      says('Yes, a PS5 Pro at about $700 fits.'),
    ]
    const events = await ask('Can I afford a PS5 Pro right now?')

    expect(events).toContainEqual({ type: 'tool', title: 'Checking the purchase' })
    const sent = JSON.parse(toolResults(0)[0]!.content)
    const today = await runAction(ctx, canIAffordAction, input)
    const plan = await runAction(ctx, whenCanIAffordAction, input)
    expect(sent).toEqual(JSON.parse(JSON.stringify({ today, plan })))
    expect(sent.today.verdict).toMatch(/^(yes|tight|no)$/)
  })

  it('never shows the model a person from a payment between people, or an account number', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Checking', mask: '4417' })
    const pay = (date: string, name: string, amountCents: number, fields = {}) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents, ...fields })
    await pay('2026-11-14', 'Zelle payment to JANE DOE JPM99A1B2C3', 5_000)
    await pay('2026-11-15', 'Venmo cashout from Zoë Ruiz 8812', -2_500)
    // Plaid puts the person in the merchant name, under a bank line that names nobody.
    await pay('2026-11-15', 'Online transfer', 4_200, {
      merchantName: 'Rosalind Fairweather',
      primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
    })
    // A bank that writes a date and a reference after the name.
    await pay('2026-11-16', 'ZELLE TO VANTERPOOL SKYE ON 11/15 REF # PP0ABC', 3_100, {
      primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    // A shop the owner buys from, paid through PayPal, is no person, so its name stays.
    await pay('2026-11-10', 'SPOTIFY USA', 1_199, {
      merchantName: 'Spotify',
      detailed: 'ENTERTAINMENT_MUSIC',
    })
    await pay('2026-11-17', 'PAYPAL *SPOTIFY', 1_199)
    const looks = ['list_transactions', 'top_merchants', 'summarize_accounts'].map((name) => ({
      id: name,
      name,
      input: {},
    }))
    provider.steps = [calls(looks), says('Done.')]
    await ask('What did I spend this week?')

    const [transactions, merchants, accounts] = toolResults(0).map((result) => result.content)
    for (const content of [transactions!, merchants!, accounts!]) {
      expect(content).not.toMatch(/jane|doe|zoë|ruiz|rosalind|fairweather|vanterpool|skye/i)
      expect(content).not.toContain('4417')
      expect(content).not.toContain('JPM99A1B2C3')
      expect(content).not.toContain('PP0ABC')
    }
    // Each payment between people is shown by its kind alone: three out, one in.
    expect(transactions!.match(/ \(sent\)"/g)).toHaveLength(3)
    expect(transactions!.match(/"Venmo payment \(received\)"/g)).toHaveLength(1)
    expect(transactions!.match(/spotify/gi)).toHaveLength(2)
    expect(merchants).toContain('"Zelle payment (sent)"')
    expect(merchants).toMatch(/spotify/i)
    expect(accounts).toContain('Zelle payment (sent)')
  })

  it('remembers what the owner says, and sends it with later questions', async () => {
    provider.steps = [
      calls([{ id: 'r', name: 'remember', input: { text: 'Saving for a wedding in June 2027' } }]),
      says("I'll keep your wedding in mind."),
    ]
    const events = await ask("We're saving for a wedding next June.")
    expect(events).toContainEqual({ type: 'tool', title: 'Remembering' })
    expect((await listFacts(ctx.db)).map((fact) => fact.text)).toEqual([
      'Saving for a wedding in June 2027',
    ])

    provider.steps = [calls([{ id: 'l', name: 'list_remembered', input: {} }]), says('Noted.')]
    await ask('What should I put aside?')
    expect(provider.conversed.at(-1)!.context).toContain('Saving for a wedding in June 2027')
    // The first question took two calls, so this one's results go with the fourth.
    expect(JSON.parse(toolResults(2)[0]!.content)).toMatchObject([
      { text: 'Saving for a wedding in June 2027' },
    ])
  })

  it('tells the model a tool it cannot use, or input it got wrong, and carries on', async () => {
    provider.steps = [
      calls([
        { id: 'a', name: 'update_category', input: { id: 'x', name: 'Fun' } },
        { id: 'b', name: 'get_budget', input: { offset: 'last' } },
      ]),
      says('I can only look, not change anything.'),
    ]
    const events = await ask('Rename my Fun category.')
    const [unknown, wrong] = toolResults(0)
    expect(unknown).toEqual({ id: 'a', content: 'Unknown tool update_category', isError: true })
    expect(wrong).toMatchObject({ id: 'b', isError: true })
    expect(wrong!.content).toMatch(/^offset:/)
    expect(lastOf(events).type).toBe('done')
  })

  it('logs a tool that fails unexpectedly, and the model only hears something went wrong', async () => {
    const budget = CHAT_TOOLS.find((tool) => tool.name === 'get_budget')!
    const spy = vi.spyOn(budget, 'run').mockRejectedValueOnce(new Error('connection lost'))
    provider.steps = [calls([{ id: 'a', name: 'get_budget', input: {} }]), says('Sorry.')]
    await ask('How is my budget?')
    spy.mockRestore()
    expect(toolResults(0)[0]).toMatchObject({
      isError: true,
      content: expect.stringMatching(/^Something went wrong/),
    })
    expect(logged).toEqual([new Error('connection lost')])
  })
  it('keeps an answer too long to save, cut to fit and saying so', async () => {
    provider.steps = [says('word '.repeat(5_000))]
    const done = lastOf(await ask('Tell me everything, at length.'))
    expect(done.type).toBe('done')
    const [, answer] = await listMessages(ctx.db)
    expect(answer!.text.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH)
    expect(answer!.text.endsWith(CUT_OFF)).toBe(true)
  })

  it('keeps nothing when the owner starts over while it answers', async () => {
    await saveExchange(ctx.db, 'Am I on track?', 'Yes.', ctx.now())
    let release = () => {}
    provider.gate = new Promise((resolve) => (release = resolve))
    const events: ChatEvent[] = []
    const running = (await openTurn(ctx, 'And next month?', () => {})).run((event) =>
      events.push(event),
    )
    await runAction(ctx, clearChatAction, {})
    release()
    await running
    expect(lastOf(events)).toEqual({ type: 'cleared' })
    expect(await listMessages(ctx.db)).toEqual([])
  })
})

describe('how an answer ends', () => {
  it('keeps what was written and says why when the model declines', async () => {
    provider.steps = [{ ...says('Hmm.'), stop: 'refused' }]
    const events = await ask('Write me a poem.')
    expect(lastOf(events)).toMatchObject({ answer: { text: `Hmm.\n\n${DECLINED}` } })
  })

  it('says an answer was cut short when it ran out of room', async () => {
    provider.steps = [{ ...says('First,'), stop: 'cut_off' }]
    const events = await ask('Tell me everything.')
    expect(lastOf(events)).toMatchObject({ answer: { text: `First,\n\n${CUT_OFF}` } })
  })

  it('never runs tools a cut-off step asked for', async () => {
    provider.steps = [
      { ...calls([{ id: 'a', name: 'remember', input: { text: 'x' } }]), stop: 'cut_off' },
    ]
    await ask('Remember this.')
    expect(await listFacts(ctx.db)).toEqual([])
    expect(provider.conversed).toHaveLength(1)
  })

  it(`stops after ${MAX_STEPS} steps and says the answer may be incomplete`, async () => {
    provider.steps = Array.from({ length: MAX_STEPS + 2 }, (_, i) =>
      calls([{ id: `c${i}`, name: 'get_budget', input: {} }]),
    )
    const events = await ask('Look at everything.')
    expect(provider.conversed).toHaveLength(MAX_STEPS)
    expect(lastOf(events)).toMatchObject({ answer: { text: TOO_MANY_STEPS } })
  })
})

describe('when a question is turned away or fails', () => {
  it('refuses without an Anthropic key', async () => {
    ctx.ai = null
    expect(await refused('Hello?')).toMatchObject({ code: 'not_configured' })
  })

  it('refuses an empty question and one too long', async () => {
    expect((await refused('   ')).message).toBe('Type a question first.')
    expect((await refused('x'.repeat(2001))).message).toBe('Keep a question to 2000 characters.')
  })

  it('answers one question at a time', async () => {
    let release = () => {}
    provider.gate = new Promise((resolve) => (release = resolve))
    const first = await openTurn(ctx, 'First?', () => {})
    const running = first.run(() => {})
    expect(await refused('Second?')).toMatchObject({ code: 'conflict' })
    // The app is told, so it can wait for the answer instead.
    expect((await runAction(ctx, getChatAction, {})).answering).toBe(true)
    release()
    await running
    provider.gate = null
    expect(lastOf(await ask('Second?')).type).toBe('done')
  })

  it('lets only one of two questions asked at the same moment through', async () => {
    const opened = await Promise.allSettled([
      openTurn(ctx, 'First?', () => {}),
      openTurn(ctx, 'Second?', () => {}),
    ])
    expect(opened.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const refusal = opened.find((result) => result.status === 'rejected')!
    expect((refusal as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' })
    // The one let through answers, then lets the next question in.
    const turn = opened.find((result) => result.status === 'fulfilled')!
    expect(isAnswering(ctx.db)).toBe(true)
    await (turn as PromiseFulfilledResult<Awaited<ReturnType<typeof openTurn>>>).value.run(() => {})
    expect(isAnswering(ctx.db)).toBe(false)
  })

  it('lets the next question in when one is turned away after it was claimed', async () => {
    await ctx.db.query(
      `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
         cache_write_tokens, cost_micros, created_at)
       VALUES ('chat', 'claude-haiku-5-5', $1, 0, 0, 0, 0, $2)`,
      [CHAT_DAILY_TOKENS, ctx.now()],
    )
    expect(await refused('Hello?')).toMatchObject({ code: 'ai_limit' })
    expect(isAnswering(ctx.db)).toBe(false)
    await ctx.db.query('DELETE FROM ai_usage')
    expect(lastOf(await ask('Hello?')).type).toBe('done')
  })

  it("stops at the day's allowance, counting cache reads at a tenth, from midnight where the owner lives", async () => {
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, { ...settings, timeZone: 'America/Denver' })
    const use = (at: string, input: number, cacheRead = 0) =>
      ctx.db.query(
        `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, cost_micros, created_at)
         VALUES ('chat', 'claude-haiku-5-5', $1, 0, $2, 0, 0, $3)`,
        [input, cacheRead, at],
      )
    // Yesterday in Denver, though the same day in UTC.
    await use('2026-11-17T06:00:00Z', CHAT_DAILY_TOKENS)
    await use('2026-11-17T08:00:00Z', CHAT_DAILY_TOKENS - 1_000, 9_990)
    expect(lastOf(await ask('Still there?')).type).toBe('done')

    await use('2026-11-17T09:00:00Z', 0, 10)
    const error = await refused('And now?')
    expect(error).toMatchObject({ code: 'ai_limit' })
    expect(error.message).toBe(
      "Chat has used today's allowance and can answer again tomorrow. Everything else in Leeway works as usual.",
    )
  })

  it('holds every call to the monthly limit, and keeps nothing when it is reached', async () => {
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, { ...settings, ai: { ...settings.ai, monthlyCapCents: 0 } })
    const events = await ask('How am I doing?')
    expect(lastOf(events)).toEqual({
      type: 'error',
      message: expect.stringMatching(/^This month's AI limit of \$0 is reached\./),
    })
    expect(provider.conversed).toHaveLength(0)
    expect(await listMessages(ctx.db)).toEqual([])
  })

  it('says what went wrong when Claude fails, keeps nothing, and lets the next question through', async () => {
    provider.steps = [new AiProviderError('busy')]
    expect(lastOf(await ask('Hello?'))).toEqual({
      type: 'error',
      message: 'Claude is busy right now. Try again in a minute.',
    })
    expect(await listMessages(ctx.db)).toEqual([])
    expect(lastOf(await ask('Hello?')).type).toBe('done')
  })

  it('logs anything unexpected and tells the owner to try again', async () => {
    provider.steps = [new Error('a bug')]
    expect(lastOf(await ask('Hello?'))).toEqual({
      type: 'error',
      message: 'Something went wrong while answering. Try again in a moment.',
    })
    expect(logged).toEqual([new Error('a bug')])
  })

  it('records a step that failed with no answer as its worst cost', async () => {
    provider.steps = [new AiProviderError('unreachable')]
    await ask('Hello?')
    const { rows } = await ctx.db.query('SELECT job, estimated FROM ai_usage')
    expect(rows).toEqual([{ job: 'chat', estimated: true }])
  })
})
