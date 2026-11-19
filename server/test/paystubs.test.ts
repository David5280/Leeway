// Paystub import end to end, with the document reader faked so no file ever
// reaches a model: the upload route and its guards, what it sends and keeps,
// saving what the owner confirmed, and that an assistant never sees any of it.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ReaderError } from '../src/ai/documents.js'
import { actionList } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { MAX_PAYSTUB_BYTES, MAX_UPLOAD_BYTES } from '../src/domain/paystubs/files.js'
import { MAX_PAYSTUBS } from '../src/domain/paystubs/paystubs.js'
import { PaystubReader, READS_PER_HOUR } from '../src/domain/paystubs/reader.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import {
  confirmedPaystub,
  FakeReader,
  heic,
  jpeg,
  NOT_A_PAYSTUB,
  pdf,
  png,
} from './fixtures/paystub.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from './helpers.js'

let ctx: AppContext
let app: FastifyInstance
let fake: FakeReader
let cookie: string
const { call, callError } = actionCaller(() => ctx)

const PAYSTUB_ACTIONS = ['get_paystub', 'save_paystub', 'delete_paystub']

beforeAll(async () => {
  ctx = await createTestContext()
  // Per-address limits are tested on an app of their own, below.
  app = await buildApp(ctx, { webDir: null, rateLimit: false })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  fake = new FakeReader()
  ctx.paystubs = new PaystubReader(fake, () => ctx.now().getTime())
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: {
      email: 'me@example.com',
      password: 'correct horse battery',
      setupCode: TEST_SETUP_CODE,
    },
  })
  cookie = `leeway_session=${setup.cookies.find((c) => c.name === 'leeway_session')!.value}`
})

/** Uploads a file as the owner, or as whoever the headers say. */
function upload(
  body: Buffer,
  headers: Record<string, string> = { cookie },
  on: FastifyInstance = app,
) {
  return on.inject({
    method: 'POST',
    url: '/api/paystubs/read',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    payload: body,
  })
}

describe('POST /api/paystubs/read', () => {
  it('reads a paystub for review, sending the file alone and keeping nothing', async () => {
    const response = await upload(pdf(), { cookie, 'content-type': 'application/pdf' })
    expect(response.statusCode).toBe(200)
    const { result } = response.json()
    expect(result.readerName).toBe('Claude')
    expect(result.extraction).toMatchObject({
      employerName: 'City of Example',
      payDate: '2026-11-13',
      payCadence: { value: 'semimonth' },
      current: { grossPay: { cents: 384_500 }, pension: { cents: 42_295 } },
    })
    // What left the server: the file's own bytes, and nothing of the owner's beside them.
    expect(fake.files).toEqual([{ bytes: pdf(), mediaType: 'application/pdf' }])
    expect(response.body).not.toMatch(/6789|004417|Bannock/)
    // Reading saves nothing: only what the owner confirms is kept.
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM paystubs')
    expect(rows[0].n).toBe(0)
  })

  it('tells the type from the bytes, whatever the browser claims', async () => {
    const response = await upload(png(), { cookie, 'content-type': 'text/plain' })
    expect(response.statusCode).toBe(200)
    expect(fake.files[0]!.mediaType).toBe('image/png')
  })

  it('takes uploads only from the signed-in owner, before reading the file', async () => {
    expect((await upload(pdf(), {})).statusCode).toBe(401)
    expect((await upload(pdf(), { cookie: 'leeway_session=forged' })).statusCode).toBe(401)
    // An assistant's token is not a session.
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    expect((await upload(pdf(), { authorization: `Bearer ${token}` })).statusCode).toBe(401)
    expect(fake.files).toEqual([])
  })

  it('says how to turn it on when there is no Anthropic key', async () => {
    ctx.paystubs = null
    const response = await upload(pdf())
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      error: 'not_configured',
      message:
        'Paystub import needs an Anthropic API key. Set ANTHROPIC_API_KEY on the server to turn it on.',
    })
  })

  it('refuses an empty upload, a type it does not read, and a HEIC photo, plainly', async () => {
    const empty = await upload(Buffer.alloc(0))
    expect(empty.statusCode).toBe(400)
    expect(empty.json().message).toBe('The file is empty.')
    const nothing = await app.inject({
      method: 'POST',
      url: '/api/paystubs/read',
      headers: { cookie },
    })
    expect(nothing.statusCode).toBe(400)
    expect(nothing.json().message).toBe('Choose a paystub file to upload.')
    const text = await upload(Buffer.from('not a paystub'))
    expect(text.statusCode).toBe(415)
    expect(text.json().message).toMatch(/^Leeway reads a paystub as a PDF, PNG or JPEG/)
    const iphone = await upload(heic())
    expect(iphone.statusCode).toBe(415)
    expect(iphone.json().message).toMatch(/^This photo is in HEIC/)
    expect(fake.files).toEqual([])
  })

  it('refuses a file over its limit, and stops reading one over every limit', async () => {
    const photo = await upload(jpeg(MAX_PAYSTUB_BYTES['image/jpeg'] + 1))
    expect(photo.statusCode).toBe(413)
    expect(photo.json().message).toMatch(/^A photo can be up to 5 MB\./)
    const huge = await upload(pdf(MAX_UPLOAD_BYTES + 1))
    expect(huge.statusCode).toBe(413)
    expect(huge.json()).toMatchObject({
      error: 'file_too_large',
      message: 'A paystub can be up to 10 MB. Try a smaller file, such as one page of the paystub.',
    })
    expect(fake.files).toEqual([])
  })

  it('says when the file holds no paystub, or the read failed', async () => {
    fake.answer = NOT_A_PAYSTUB
    const notOne = await upload(pdf())
    expect(notOne.statusCode).toBe(400)
    expect(notOne.json().message).toMatch(/^This does not look like a paystub/)
    fake.answer = new ReaderError('Claude is busy right now. Try again in a minute.')
    const failed = await upload(png())
    expect(failed.statusCode).toBe(502)
    expect(failed.json()).toMatchObject({
      error: 'reader_error',
      message: 'Claude is busy right now. Try again in a minute.',
    })
  })

  it('reads a file once, however often it is sent, and caps paid reads an hour', async () => {
    await upload(pdf())
    await upload(pdf())
    expect(fake.files).toHaveLength(1)
    for (let n = 1; n < READS_PER_HOUR; n++) {
      expect((await upload(Buffer.concat([pdf(), Buffer.from(`${n}`)]))).statusCode).toBe(200)
    }
    const paused = await upload(png())
    expect(paused.statusCode).toBe(429)
    expect(paused.json()).toMatchObject({ error: 'too_many_attempts' })
    expect(fake.files).toHaveLength(READS_PER_HOUR)
  })

  it('leaves every other route reading JSON as before', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/get_paystub',
      headers: { cookie },
      payload: {},
    })
    expect(response.statusCode).toBe(200)
  })
})

describe('the per-address limit on uploads', () => {
  it('stops one address after ten uploads a minute', async () => {
    const limited = await buildApp(ctx, { webDir: null })
    try {
      // Refused files, so the hourly cap on reads is not what stops them.
      for (let n = 0; n < 10; n++) {
        expect((await upload(Buffer.from('x'), { cookie }, limited)).statusCode).toBe(415)
      }
      expect((await upload(pdf(), { cookie }, limited)).statusCode).toBe(429)
      expect(fake.files).toEqual([])
    } finally {
      await limited.close()
    }
  })
})

describe('get_paystub', () => {
  it('says whether import is on, who reads, what it takes, and the newest paystub', async () => {
    expect(await call('get_paystub')).toEqual({
      available: true,
      readerName: 'Claude',
      types: ['application/pdf', 'image/png', 'image/jpeg'],
      maxBytes: MAX_PAYSTUB_BYTES,
      latest: null,
    })
    ctx.paystubs = null
    expect(await call('get_paystub')).toMatchObject({ available: false, readerName: null })
  })
})

describe('save_paystub', () => {
  it('keeps the figures the owner confirmed, and gives the newest by pay date', async () => {
    const saved = await call('save_paystub', { paystub: confirmedPaystub() })
    expect(saved).toMatchObject({
      paystub: { ...confirmedPaystub(), pensionAccountId: null, id: expect.any(String) },
      pension: null,
      retirementMonthlyContributionCents: null,
    })
    // An employer name cleared on the review screen is kept as not known.
    const older = await call('save_paystub', {
      paystub: confirmedPaystub({ payDate: '2026-10-31', employerName: '  ' }),
    })
    expect(older.paystub.employerName).toBeNull()
    expect((await call('get_paystub')).latest).toMatchObject({
      id: saved.paystub.id,
      payDate: '2026-11-13',
    })
  })

  it('puts the pension figures on the pension the owner chose, leaving the rest as they were', async () => {
    const pera = await call('create_pension', { name: 'Colorado PERA', serviceYears: 9.5 })
    const saved = await call('save_paystub', {
      paystub: confirmedPaystub(),
      pensionAccountId: pera.accountId,
    })
    expect(saved.pension!.plan).toMatchObject({
      contribution: { kind: 'amount', cents: 42_295 },
      grossPayCents: 384_500,
      payCadence: 'semimonth',
      // $822.83 of $3,845.00 gross.
      employerContributionPercent: 21.4,
      serviceYears: 9.5,
    })
    expect(saved.paystub.pensionAccountId).toBe(pera.accountId)
    // A paystub without those figures changes nothing on the pension.
    const bare = confirmedPaystub({ payCadence: null })
    bare.current = { ...bare.current, grossPay: null, netPay: null, pension: null }
    const again = await call('save_paystub', { paystub: bare, pensionAccountId: pera.accountId })
    expect(again.pension!.plan).toEqual(saved.pension!.plan)
  })

  it('makes the 401(k), 457 and 403(b) figures the monthly contribution, when asked', async () => {
    const paystub = confirmedPaystub()
    paystub.current = { ...paystub.current, plan401k: 10_000 }
    const saved = await call('save_paystub', { paystub, setRetirementContribution: true })
    // $300 twice a month is $600 a month.
    expect(saved.retirementMonthlyContributionCents).toBe(60_000)
    const { plan } = await call('project_retirement')
    expect(plan.assumptions.monthlyContributionCents).toBe(60_000)
  })

  it('saves nothing at all when any part of it cannot be done', async () => {
    const noPlans = confirmedPaystub()
    noPlans.current = { ...noPlans.current, plan457: null }
    expect(
      (await callError('save_paystub', { paystub: noPlans, setRetirementContribution: true }))
        .message,
    ).toBe('This paystub shows no 401(k), 457 or 403(b) contribution.')
    expect(
      (
        await callError('save_paystub', {
          paystub: confirmedPaystub({ payCadence: null }),
          setRetirementContribution: true,
        })
      ).message,
    ).toBe('Choose how often you are paid to work out a month of it.')
    const unknown = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      pensionAccountId: '00000000-0000-4000-8000-000000000000',
      setRetirementContribution: true,
    })
    expect(unknown.code).toBe('not_found')
    expect((await call('get_paystub')).latest).toBeNull()
    expect((await call('project_retirement')).plan.assumptions.monthlyContributionCents).toBeNull()
  })

  it('refuses a monthly contribution above the limit plainly, saving nothing', async () => {
    // $50,000 a week into a 401(k) is about $217,411 a month, at 52.18 weeks a year.
    const weekly = confirmedPaystub({ payCadence: 'week' })
    weekly.current = { ...weekly.current, plan401k: 5_000_000, plan457: null }
    const refused = await callError('save_paystub', {
      paystub: weekly,
      setRetirementContribution: true,
    })
    expect(refused).toMatchObject({
      code: 'invalid_input',
      message:
        'The 401(k), 457 and 403(b) figures come to $217,411 a month, more than the $100,000 a month Leeway takes as a contribution. Check them against your paystub.',
    })
    expect((await call('get_paystub')).latest).toBeNull()
  })

  it('holds a paycheck figure to what a pension takes, so none can pass it on too large', async () => {
    const pera = await call('create_pension', { name: 'Colorado PERA' })
    const huge = confirmedPaystub()
    huge.current = { ...huge.current, pension: 50_000_000 }
    const refused = await callError('save_paystub', {
      paystub: huge,
      pensionAccountId: pera.accountId,
    })
    expect(refused.message).toBe('paystub.current.pension: Use $100,000 or less')
    const [pension] = (await call('project_retirement')).plan.pensions
    expect(pension!.plan.contribution).toBeNull()
  })

  it('refuses figures no paystub has', async () => {
    const backwards = confirmedPaystub()
    backwards.current = { ...backwards.current, netPay: 400_000 }
    expect((await callError('save_paystub', { paystub: backwards })).message).toContain(
      'Take-home pay cannot be more than gross pay',
    )
    const huge = confirmedPaystub()
    huge.yearToDate = { ...huge.yearToDate, grossPay: 100_000_001 }
    expect((await callError('save_paystub', { paystub: huge })).message).toContain(
      'Use $1,000,000 or less',
    )
    const negative = confirmedPaystub()
    negative.current = { ...negative.current, hsa: -1 }
    expect((await callError('save_paystub', { paystub: negative })).message).toContain(
      'A figure cannot be negative',
    )
    const tooLong = confirmedPaystub({ employerName: 'E'.repeat(81) })
    expect((await callError('save_paystub', { paystub: tooLong })).code).toBe('invalid_input')
  })

  it(`keeps the newest ${MAX_PAYSTUBS}, letting the oldest go`, async () => {
    for (let n = 0; n <= MAX_PAYSTUBS; n++) {
      const day = new Date(Date.UTC(2025, 10, 1 + n * 7)).toISOString().slice(0, 10)
      await call('save_paystub', { paystub: confirmedPaystub({ payDate: day }) })
    }
    const { rows } = await ctx.db.query<{ n: number; oldest: string }>(
      `SELECT count(*)::int AS n, min(pay_date)::text AS oldest FROM paystubs`,
    )
    expect(rows[0]).toEqual({ n: MAX_PAYSTUBS, oldest: '2025-11-08' })
  })

  it(`keeps the one just saved past ${MAX_PAYSTUBS}, even with no pay date or an older one`, async () => {
    const pera = await call('create_pension', { name: 'Colorado PERA' })
    for (let n = 0; n < MAX_PAYSTUBS; n++) {
      const day = new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)
      await call('save_paystub', { paystub: confirmedPaystub({ payDate: day }) })
    }
    const kept = async () =>
      (
        await ctx.db.query<{ id: string }>(
          'SELECT id FROM paystubs ORDER BY pay_date NULLS FIRST LIMIT 1',
        )
      ).rows[0]!.id
    // With no pay date it sorts as the oldest, yet it is kept, and its pension updated.
    const undated = await call('save_paystub', {
      paystub: confirmedPaystub({ payDate: null }),
      pensionAccountId: pera.accountId,
    })
    expect(undated.paystub.payDate).toBeNull()
    expect(undated.pension!.plan.contribution).toEqual({ kind: 'amount', cents: 42_295 })
    expect(await kept()).toBe(undated.paystub.id)
    // A paystub older than every other one is kept the same way.
    const backDated = await call('save_paystub', {
      paystub: confirmedPaystub({ payDate: '2020-01-15' }),
    })
    expect(backDated.paystub.payDate).toBe('2020-01-15')
    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM paystubs')
    expect(rows[0]!.n).toBe(MAX_PAYSTUBS)
    const ids = (await ctx.db.query<{ id: string }>('SELECT id FROM paystubs')).rows.map(
      (row) => row.id,
    )
    expect(ids).toContain(backDated.paystub.id)
    // The undated one is now the oldest kept, so it gave way to the newer back-dated one.
    expect(ids).not.toContain(undated.paystub.id)
  })

  it('keeps a paystub when its pension goes, and deletes one on request', async () => {
    const pera = await call('create_pension', { name: 'Colorado PERA' })
    const { paystub } = await call('save_paystub', {
      paystub: confirmedPaystub(),
      pensionAccountId: pera.accountId,
    })
    await call('delete_account', { id: pera.accountId })
    expect((await call('get_paystub')).latest).toMatchObject({
      id: paystub.id,
      pensionAccountId: null,
    })
    expect(await call('delete_paystub', { id: paystub.id })).toEqual({ deleted: true })
    expect((await call('get_paystub')).latest).toBeNull()
    expect((await callError('delete_paystub', { id: paystub.id })).code).toBe('not_found')
  })
})

describe('what an assistant sees of paystubs', () => {
  it('has no paystub tool, read or write, and the app keeps all three', async () => {
    const names = (scope: 'read' | 'write') => agentTools(scope).map((tool) => tool.name)
    for (const name of PAYSTUB_ACTIONS) {
      expect(names('write')).not.toContain(name)
      expect(actionList.find((action) => action.name === name)).toMatchObject({ surface: 'app' })
    }
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    const listed = list.json().result.tools.map((tool: { name: string }) => tool.name)
    expect(listed.filter((name: string) => /paystub/.test(name))).toEqual([])
  })

  it("never puts a saved paystub's figures into the profile an assistant reads", async () => {
    await call('save_paystub', { paystub: confirmedPaystub() })
    const profile = JSON.stringify(await call('get_financial_profile'))
    expect(profile).not.toMatch(/City of Example|384500|261142|paystub/i)
  })
})
