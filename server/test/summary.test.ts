import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SummaryWriter } from '../src/ai/writer.js'
import { findAction } from '../src/actions/index.js'
import { AiLimitError } from '../src/domain/ai/gateway.js'
import { RETRY_AFTER_MINUTES, REUSE_HOURS } from '../src/domain/summary.js'
import type { SummaryFacts, SummaryText } from '../src/domain/summaryText.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'
import { withoutUuids } from './uuids.js'

/** A stand-in for Claude that records what it was told and can be made to fail. */
class FakeWriter implements SummaryWriter {
  readonly name = 'Claude'
  calls: SummaryFacts[] = []
  failWith: string | null = null
  /** Throws `failWith` as a bare string instead of an Error, as some libraries do. */
  throwBareString = false
  /** Holds each write until release() runs, to test two loads at once. */
  gate: Promise<void> | null = null

  /** Throws the monthly limit's error instead of writing. */
  limit: AiLimitError | null = null

  async write(facts: SummaryFacts): Promise<SummaryText> {
    this.calls.push(facts)
    if (this.gate) await this.gate
    if (this.limit) throw this.limit
    if (this.failWith && this.throwBareString) throw this.failWith
    if (this.failWith) throw new Error(this.failWith)
    return { headline: `Written from ${facts.period.spent} spent`, points: ['All good.'] }
  }
}

const START = new Date('2026-11-17T15:00:00Z')
const writer = new FakeWriter()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: START, writer })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(START)
  writer.calls = []
  writer.failWith = null
  writer.throwBareString = false
  writer.gate = null
  writer.limit = null
})

const later = (minutes: number) => new Date(START.getTime() + minutes * 60_000)

/** Spends on a new account today, which changes the facts a summary is written from. */
async function spend(cents: number) {
  const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100000 })
  await insertBankTransaction(ctx.db, accountId, {
    date: '2026-11-17',
    name: 'Shop',
    amountCents: cents,
  })
}

describe('get_summary in Leeway’s own words', () => {
  it('is what the dashboard shows until the owner turns the AI summary on', async () => {
    const summary = await call('get_summary')
    expect(summary).toEqual({
      headline: "You've spent $0 this month. Set budgets to see what's left.",
      points: [],
      writtenBy: 'Leeway',
      writtenAt: START.toISOString(),
      ai: 'off',
    })
    expect(writer.calls).toEqual([])
  })

  it('says the key is missing when turned on without one', async () => {
    ctx.writer = null
    try {
      await call('set_ai_summary', { on: true })
      expect(await call('get_summary')).toMatchObject({ writtenBy: 'Leeway', ai: 'no_key' })
    } finally {
      ctx.writer = writer
    }
  })
})

describe('get_summary and the monthly AI limit', () => {
  it("falls back to Leeway's words, says when the limit resets, and asks again on the next load", async () => {
    await call('set_ai_summary', { on: true })
    writer.limit = new AiLimitError("This month's AI limit of $5 is reached.", '2026-12-01')
    expect(await call('get_summary')).toMatchObject({
      writtenBy: 'Leeway',
      ai: 'limit',
      limitResetsOn: '2026-12-01',
    })
    // Nothing is saved, so the next load asks again, and once the limit allows it, Claude writes.
    writer.limit = null
    expect(await call('get_summary')).toMatchObject({ writtenBy: 'Claude', ai: 'on' })
    expect(writer.calls).toHaveLength(2)
  })
})

describe('get_summary and account names', () => {
  /** An account the bank calls TOTAL CHECKING, at Test Bank, $42.10 below zero. */
  const overdraw = () => insertBankAccount(ctx.db, { name: 'TOTAL CHECKING', balanceCents: -4210 })

  it('names the overdrawn account as the alerts beside it do', async () => {
    await overdraw()
    const [alert] = await call('list_alerts')
    const { headline } = await call('get_summary')
    expect(headline).toBe('Test Total Checking is overdrawn by $42.10.')
    expect(headline).toBe(alert!.message)
  })

  it('hands the AI writer the account by the same name', async () => {
    await overdraw()
    await call('set_ai_summary', { on: true })
    await call('get_summary')
    expect(writer.calls[0]).toMatchObject({
      fixedHeadline: 'Test Total Checking is overdrawn by $42.10.',
      accountAlerts: ['Test Total Checking is overdrawn by $42.10.'],
    })
  })

  it('never hands the AI writer an account number, even one in the bank name', async () => {
    await insertBankAccount(ctx.db, {
      name: 'CHECKING ...4417',
      mask: '4417',
      balanceCents: -4210,
    })
    await call('set_ai_summary', { on: true })
    await call('get_summary')
    expect(writer.calls[0]!.fixedHeadline).toBe('Test Checking is overdrawn by $42.10.')
    expect(withoutUuids(JSON.stringify(writer.calls[0]))).not.toContain('4417')
  })

  it('never hands the AI writer a short mask the bank put in the name', async () => {
    await insertBankAccount(ctx.db, { name: 'CHECKING 417', mask: '417', balanceCents: -4210 })
    await call('set_ai_summary', { on: true })
    await call('get_summary')
    expect(writer.calls[0]!.fixedHeadline).toBe('Test Checking is overdrawn by $42.10.')
    expect(JSON.stringify(writer.calls[0])).not.toMatch(/\b417\b/)
  })

  it("uses the owner's own name for the account when there is one", async () => {
    const { accountId } = await overdraw()
    await call('update_account', { id: accountId, displayName: 'Bills' })
    expect((await call('get_summary')).headline).toBe('Bills is overdrawn by $42.10.')
  })
})

describe('get_summary written by the AI', () => {
  beforeEach(async () => {
    await call('set_ai_summary', { on: true })
  })

  it('writes from the formatted facts and says who wrote it', async () => {
    const summary = await call('get_summary')
    expect(summary).toEqual({
      headline: 'Written from $0 spent',
      points: ['All good.'],
      writtenBy: 'Claude',
      writtenAt: START.toISOString(),
      ai: 'on',
    })
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0]).toMatchObject({ today: 'Nov 17', period: { kind: 'month' } })
  })

  it('reuses the saved summary while the numbers are unchanged', async () => {
    await call('get_summary')
    ctx.setNow(later(REUSE_HOURS * 60 + 30))
    const summary = await call('get_summary')
    expect(writer.calls).toHaveLength(1)
    expect(summary.writtenAt).toBe(START.toISOString())
  })

  it('keeps a recent summary when the numbers move, and rewrites an older one', async () => {
    await call('get_summary')
    await spend(2500)
    ctx.setNow(later(60))
    expect((await call('get_summary')).headline).toBe('Written from $0 spent')
    ctx.setNow(later(REUSE_HOURS * 60 + 1))
    expect((await call('get_summary')).headline).toBe('Written from $25 spent')
    expect(writer.calls).toHaveLength(2)
  })

  it('writes a fresh one on a new day and forgets the old days', async () => {
    await call('get_summary')
    ctx.setNow(new Date('2026-11-18T15:00:00Z'))
    await call('get_summary')
    expect(writer.calls).toHaveLength(2)
    const { rows } = await ctx.db.query<{ day: string }>('SELECT day FROM ai_summaries')
    expect(rows).toEqual([{ day: '2026-11-18' }])
  })

  it('falls back to Leeway’s words when writing fails, and waits before trying again', async () => {
    writer.failWith = 'overloaded'
    expect(await call('get_summary')).toMatchObject({ writtenBy: 'Leeway', ai: 'unavailable' })
    writer.failWith = null
    ctx.setNow(later(RETRY_AFTER_MINUTES - 1))
    expect(await call('get_summary')).toMatchObject({ ai: 'unavailable' })
    expect(writer.calls).toHaveLength(1)
    ctx.setNow(later(RETRY_AFTER_MINUTES + 1))
    expect(await call('get_summary')).toMatchObject({ writtenBy: 'Claude', ai: 'on' })
    expect(writer.calls).toHaveLength(2)
  })

  it('falls back to Leeway’s words when the writer throws something that is not an Error', async () => {
    writer.failWith = 'socket hang up'
    writer.throwBareString = true
    expect(await call('get_summary')).toMatchObject({ writtenBy: 'Leeway', ai: 'unavailable' })
    const { rows } = await ctx.db.query<{ error: string }>('SELECT error FROM ai_summaries')
    expect(rows).toEqual([{ error: 'socket hang up' }])
  })

  it('shares one write between two loads at the same moment', async () => {
    let release = () => {}
    writer.gate = new Promise((resolve) => (release = resolve))
    const both = Promise.all([call('get_summary'), call('get_summary')])
    // Let both loads reach the writer before it answers.
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    const [first, second] = await both
    expect(first.headline).toBe(second.headline)
    expect(writer.calls).toHaveLength(1)
  })

  it('goes back to Leeway’s words when turned off', async () => {
    await call('set_ai_summary', { on: false })
    expect(await call('get_summary')).toMatchObject({ writtenBy: 'Leeway', ai: 'off' })
    expect(writer.calls).toEqual([])
  })
})

describe('who can turn it on', () => {
  it('is the owner in the app only, never an assistant', () => {
    expect(findAction('set_ai_summary')).toMatchObject({ surface: 'app', scope: 'write' })
    expect(findAction('get_summary')).toMatchObject({ surface: 'all', scope: 'read' })
  })

  it('cannot be changed through update_settings or a settings import', async () => {
    const error = await callError('update_settings', { aiSummary: true })
    expect(error.code).toBe('invalid_input')
    const config = { app: 'leeway', version: 1, settings: { aiSummary: true } }
    await call('import_config', { config, mode: 'merge' })
    expect((await call('get_settings')).aiSummary).toBe(false)
  })
})
