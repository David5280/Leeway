import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import {
  addFlowsWidget,
  addSummaryWidget,
  leadWithLeeway,
  withFlows,
} from '../src/domain/dashboardUpgrade.js'
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
    await call('update_settings', {
      dashboard: { widgets: [{ type: 'summary' }, { type: 'leeway' }] },
    })
    expect(await addSummaryWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(['summary', 'leeway'])
  })

  it("leaves a new install's default alone, as it never saved a dashboard", async () => {
    const before = await types()
    expect(before).not.toContain('summary')
    expect(await addSummaryWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(before)
  })
})

describe('leadWithLeeway', () => {
  /** The default Overview before the change, summary first. */
  const oldDefault = [
    { type: 'summary', size: 'full' },
    { type: 'leeway', size: 'wide' },
    { type: 'glance', size: 'half' },
    { type: 'alerts', size: 'full' },
    { type: 'categories', size: 'wide' },
    { type: 'pace', size: 'half' },
    { type: 'recent', size: 'wide' },
    { type: 'accounts', size: 'half' },
  ] as const
  const saveOldDefault = () =>
    call('update_settings', { dashboard: { widgets: oldDefault.map((w) => ({ ...w })) } })

  it('gives a dashboard still in the old default order the new one, once', async () => {
    await saveOldDefault()
    expect(await leadWithLeeway(ctx.db)).toBe(true)
    expect(await types()).toEqual(['leeway', 'net-worth', 'alerts', 'flows', 'pace'])

    // Put back by the owner afterwards, it stays as they put it.
    await saveOldDefault()
    expect(await leadWithLeeway(ctx.db)).toBe(false)
    expect(await types()).toEqual(oldDefault.map((w) => w.type))
  })

  it('leaves a dashboard the owner arranged alone, even one that differs only in size', async () => {
    const resized = oldDefault.map((w) => ({ ...w, size: w.type === 'pace' ? 'wide' : w.size }))
    await call('update_settings', { dashboard: { widgets: resized } })
    expect(await leadWithLeeway(ctx.db)).toBe(false)
    expect(await types()).toEqual(oldDefault.map((w) => w.type))
  })
})

describe('addFlowsWidget', () => {
  it('adds the income and spending chart to an arranged dashboard, keeping its order, once', async () => {
    await call('update_settings', {
      dashboard: {
        widgets: [
          { type: 'alerts' },
          { type: 'leeway', size: 'wide' },
          { type: 'pace', size: 'half', visible: false },
          { type: 'recent' },
        ],
      },
    })
    expect(await addFlowsWidget(ctx.db)).toBe(true)
    expect(await types()).toEqual(['alerts', 'leeway', 'flows', 'pace', 'recent'])
    const widgets = (await call('get_settings')).dashboard.widgets
    expect(widgets[2]).toEqual({ type: 'flows', size: 'full', visible: true })
    // The others keep their sizes and whether they show.
    expect(widgets[3]).toEqual({ type: 'pace', size: 'half', visible: false })

    // Removed by the owner afterwards, it stays removed.
    await call('update_settings', { dashboard: { widgets: [{ type: 'leeway' }] } })
    expect(await addFlowsWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway'])
  })

  it('leaves a dashboard that has it, and a default never saved, alone', async () => {
    const before = await types()
    expect(await addFlowsWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(before)

    await resetData(ctx.db)
    await call('update_settings', { dashboard: { widgets: [{ type: 'pace' }, { type: 'flows' }] } })
    expect(await addFlowsWidget(ctx.db)).toBe(false)
    expect(await types()).toEqual(['pace', 'flows'])
  })

  it('puts it before the spending pace, or after what is left to spend, or last', () => {
    const order = (types: ('leeway' | 'pace' | 'recent' | 'alerts')[]) =>
      withFlows(types.map((type) => ({ type, size: 'half', visible: true }))).map((w) => w.type)
    expect(order(['recent', 'pace', 'leeway'])).toEqual(['recent', 'flows', 'pace', 'leeway'])
    expect(order(['leeway', 'recent'])).toEqual(['leeway', 'flows', 'recent'])
    expect(order(['recent', 'alerts'])).toEqual(['recent', 'alerts', 'flows'])
    expect(order([])).toEqual(['flows'])
  })
})
