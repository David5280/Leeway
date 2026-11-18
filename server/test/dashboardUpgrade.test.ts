import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { addSummaryWidget } from '../src/domain/dashboardUpgrade.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const types = async () => (await call('get_settings')).dashboard.widgets.map((w) => w.type)

describe('addSummaryWidget', () => {
  it('puts the summary at the top of a dashboard saved before it existed, once', async () => {
    await call('update_settings', {
      dashboard: { widgets: [{ type: 'leeway' }, { type: 'recent', size: 'half' }] },
    })
    expect(await addSummaryWidget(ctx.db)).toBe(true)
    expect(await types()).toEqual(['summary', 'leeway', 'recent'])
    expect((await call('get_settings')).dashboard.widgets[0]).toEqual({
      type: 'summary',
      size: 'full',
      visible: true,
    })

    // Removed by the owner afterwards, it stays removed.
    await call('update_settings', { dashboard: { widgets: [{ type: 'leeway' }] } })
    expect(await addSummaryWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway'])
  })

  it('leaves a dashboard that already has the summary alone', async () => {
    expect(await types()).toContain('summary')
    const before = await types()
    expect(await addSummaryWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(before)
  })
})
