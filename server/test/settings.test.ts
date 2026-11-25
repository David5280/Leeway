import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getSettings, settingsSchema } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** Stores a raw settings document, as an older version of Leeway might have left it. */
const store = (json: string) => ctx.db.query('UPDATE settings SET data = $1::jsonb', [json])

describe('reading stored settings', () => {
  it('falls back to defaults when the stored document is not an object', async () => {
    await store('42')
    expect(await getSettings(ctx.db)).toEqual(settingsSchema.parse({}))
  })

  it('keeps the valid fields of a broken document and drops options that no longer exist', async () => {
    await store('{"currency": "dollars", "locale": "en-GB", "oldOption": true}')

    const settings = await getSettings(ctx.db)

    expect(settings).toMatchObject({ currency: 'USD', locale: 'en-GB' })
    expect(settings).not.toHaveProperty('oldOption')
  })

  it('uses the default look when the stored appearance is not an object', async () => {
    await store('{"appearance": "neon", "includePending": false}')

    const settings = await getSettings(ctx.db)

    expect(settings.appearance).toEqual(settingsSchema.parse({}).appearance)
    expect(settings.includePending).toBe(false)
  })
})

describe("saving Home's cards", () => {
  /** A layout of cards by type, each shown unless named in `hidden`. */
  const widgets = (types: string[], hidden: string[] = []) =>
    types.map((type) => ({ type, size: 'half', visible: !hidden.includes(type) }))

  it.each(['cash-flow', 'pace', 'goals', 'net-worth'])(
    'refuses the tab row shown beside the %s card on its own, the same figure twice',
    async (tabCard) => {
      const failure = await callError('update_settings', {
        dashboard: { widgets: widgets(['leeway', 'tab-row', tabCard]) },
      })
      expect(failure.code).toBe('invalid_input')
      expect(failure.message).toContain(
        'Show the tab summaries row or the tab cards on their own, not both',
      )
      expect((await getSettings(ctx.db)).dashboard.widgets.map((w) => w.type)).not.toContain(
        tabCard,
      )
    },
  )

  it('saves either one shown beside the other hidden', async () => {
    const rowShown = widgets(['tab-row', 'pace', 'goals'], ['pace', 'goals'])
    await call('update_settings', { dashboard: { widgets: rowShown } })
    expect((await getSettings(ctx.db)).dashboard.widgets).toEqual(rowShown)

    const cardsShown = widgets(['tab-row', 'pace', 'goals'], ['tab-row'])
    await call('update_settings', { dashboard: { widgets: cardsShown } })
    expect((await getSettings(ctx.db)).dashboard.widgets).toEqual(cardsShown)
  })
})
