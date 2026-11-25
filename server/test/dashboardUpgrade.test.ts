import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { addSummaryWidget, followHomeMap } from '../src/domain/dashboardUpgrade.js'
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
      dashboard: { widgets: [{ type: 'leeway' }, { type: 'goals', size: 'half' }] },
    })
    expect(await addSummaryWidget(ctx.db)).toBe(true)
    expect(await types()).toEqual(['summary', 'leeway', 'goals'])
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

/** Stores a dashboard as an older Leeway saved it, removed card kinds and all. */
async function storeWidgets(widgets: object[]): Promise<void> {
  await ctx.db.query(
    `UPDATE settings SET data = jsonb_set(data, '{dashboard}', jsonb_build_object('widgets', $1::jsonb))`,
    [JSON.stringify(widgets)],
  )
}

describe('a saved dashboard naming a removed card', () => {
  it('still loads, with the removed card left out and every other card kept', async () => {
    await storeWidgets([
      { type: 'leeway', size: 'wide', visible: true },
      { type: 'glance', size: 'half', visible: true },
      { type: 'pace', size: 'full', visible: false },
    ])
    const widgets = (await call('get_settings')).dashboard.widgets
    expect(widgets).toEqual([
      { type: 'leeway', size: 'wide', visible: true },
      { type: 'pace', size: 'full', visible: false },
    ])
  })
})

describe('followHomeMap', () => {
  /** A widget shown, as every default layout stored them. */
  const shown = (type: string, size: string) => ({ type, size, visible: true })

  /** Home's default just before it followed the map, as it was stored. */
  const before = [
    shown('leeway', 'wide'),
    shown('net-worth', 'half'),
    shown('alerts', 'full'),
    shown('flows', 'full'),
    shown('pace', 'full'),
  ]
  /** Older defaults an install that skipped versions may still have stored. */
  const summaryFirst = [
    shown('summary', 'full'),
    shown('leeway', 'wide'),
    shown('glance', 'half'),
    shown('alerts', 'full'),
    shown('categories', 'wide'),
    shown('pace', 'half'),
    shown('recent', 'wide'),
    shown('accounts', 'half'),
  ]
  const beforeFlows = [
    shown('leeway', 'wide'),
    shown('alerts', 'full'),
    shown('summary', 'full'),
    shown('pace', 'full'),
    shown('glance', 'full'),
    shown('categories', 'wide'),
    shown('accounts', 'half'),
    shown('recent', 'wide'),
  ]
  /** beforeFlows once the income and spending card was added ahead of the pace. */
  const flowsAdded = [...beforeFlows.slice(0, 3), shown('flows', 'full'), ...beforeFlows.slice(3)]
  const mapOrder = ['leeway', 'alerts', 'cash-flow', 'pace', 'goals', 'net-worth']

  it('gives a dashboard still in the last default the map order, once', async () => {
    await storeWidgets(before)
    expect(await followHomeMap(ctx.db)).toBe(true)
    expect(await types()).toEqual(mapOrder)

    // Put back by an older Leeway afterwards, it stays as it was put.
    await storeWidgets(before)
    expect(await followHomeMap(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway', 'net-worth', 'alerts', 'pace'])
  })

  it.each([
    ['summary first', summaryFirst],
    ['before the income and spending card', beforeFlows],
    ['with the income and spending card added', flowsAdded],
  ])('gives an install that skipped versions, still %s, the map order', async (_, layout) => {
    await storeWidgets(layout)
    expect(await followHomeMap(ctx.db)).toBe(true)
    expect(await types()).toEqual(mapOrder)
  })

  it('leaves a dashboard the owner arranged alone, even one that differs only in size', async () => {
    await storeWidgets(before.map((w) => (w.type === 'pace' ? { ...w, size: 'half' } : w)))
    expect(await followHomeMap(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway', 'net-worth', 'alerts', 'pace'])
  })

  it('leaves an older default the owner changed alone, even by one hidden card', async () => {
    const hidden = summaryFirst.map((w) => (w.type === 'pace' ? { ...w, visible: false } : w))
    await storeWidgets(hidden)
    expect(await followHomeMap(ctx.db)).toBe(false)
    expect(await types()).toEqual(['summary', 'leeway', 'alerts', 'pace'])
  })

  it('leaves an older default with a card taken out alone', async () => {
    await storeWidgets(beforeFlows.filter((w) => w.type !== 'recent'))
    expect(await followHomeMap(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway', 'alerts', 'summary', 'pace'])
  })

  it("leaves a new install's default alone, as it never saved a dashboard", async () => {
    expect(await followHomeMap(ctx.db)).toBe(false)
    expect(await types()).toEqual(mapOrder)
  })
})
