import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { addSummaryWidget, upgradeDefaultHome } from '../src/domain/dashboardUpgrade.js'
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

describe('upgradeDefaultHome', () => {
  /** A widget shown, as every default layout stored them. */
  const shown = (type: string, size: string) => ({ type, size, visible: true })

  /** Home's map order, the default just before the accounts came to Home, as it was stored. */
  const mapDefault = [
    shown('leeway', 'wide'),
    shown('alerts', 'full'),
    shown('cash-flow', 'half'),
    shown('pace', 'half'),
    shown('goals', 'half'),
    shown('net-worth', 'half'),
  ]
  /** The default before the map order. */
  const beforeMap = [
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
  const defaultHome = [
    'leeway',
    'alerts',
    'account-list',
    'coming-up',
    'latest-activity',
    'tab-row',
  ]
  const mapOrder = mapDefault.map((w) => w.type)

  it('gives a dashboard still in the map order the default Home, once', async () => {
    await storeWidgets(mapDefault)
    expect(await upgradeDefaultHome(ctx.db)).toBe(true)
    expect((await call('get_settings')).dashboard.widgets).toEqual([
      { type: 'leeway', size: 'wide', visible: true },
      { type: 'alerts', size: 'full', visible: true },
      { type: 'account-list', size: 'wide', visible: true },
      { type: 'coming-up', size: 'half', visible: true },
      { type: 'latest-activity', size: 'half', visible: true },
      { type: 'tab-row', size: 'full', visible: true },
    ])

    // Put back by the owner afterwards, it stays as it was put.
    await storeWidgets(mapDefault)
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(mapOrder)
  })

  it('moves an install the replaced map upgrade already ran on to the default Home, once', async () => {
    // "home-map" gave this install the map order; today's upgrade has its own name.
    await ctx.db.query("INSERT INTO applied_upgrades (name) VALUES ('home-map')")
    await storeWidgets(mapDefault)
    expect(await upgradeDefaultHome(ctx.db)).toBe(true)
    expect(await types()).toEqual(defaultHome)

    // A later start runs nothing again, even with the map order put back.
    await storeWidgets(mapDefault)
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(mapOrder)
  })

  it.each([
    ['before the map order', beforeMap],
    ['summary first', summaryFirst],
    ['before the income and spending card', beforeFlows],
    ['with the income and spending card added', flowsAdded],
  ])('gives an install that skipped versions, still %s, the default Home', async (_, layout) => {
    await storeWidgets(layout)
    expect(await upgradeDefaultHome(ctx.db)).toBe(true)
    expect(await types()).toEqual(defaultHome)
  })

  it('leaves a map order the owner rearranged as it was', async () => {
    // Net worth moved up, just under the alerts.
    const [top, tabs] = [mapDefault.slice(0, 2), mapDefault.slice(2)]
    await storeWidgets([...top, ...tabs.slice(-1), ...tabs.slice(0, -1)])
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(['leeway', 'alerts', 'net-worth', 'cash-flow', 'pace', 'goals'])
  })

  it('moves a map order that differs only in a size, as resizing is not arranging', async () => {
    await storeWidgets(mapDefault.map((w) => (w.type === 'goals' ? { ...w, size: 'wide' } : w)))
    expect(await upgradeDefaultHome(ctx.db)).toBe(true)
    expect(await types()).toEqual(defaultHome)
  })

  it('leaves a map order alone with one card hidden', async () => {
    await storeWidgets(mapDefault.map((w) => (w.type === 'pace' ? { ...w, visible: false } : w)))
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect((await call('get_settings')).dashboard.widgets[3]).toEqual({
      type: 'pace',
      size: 'half',
      visible: false,
    })
  })

  it('leaves a map order alone with a card added or taken out', async () => {
    await storeWidgets([...mapDefault, shown('trends', 'half')])
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual([...mapOrder, 'trends'])

    await resetData(ctx.db)
    await storeWidgets(mapDefault.filter((w) => w.type !== 'goals'))
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(mapOrder.filter((type) => type !== 'goals'))
  })

  it('leaves an older default the owner changed alone, even by one hidden card', async () => {
    const hidden = summaryFirst.map((w) => (w.type === 'pace' ? { ...w, visible: false } : w))
    await storeWidgets(hidden)
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(['summary', 'leeway', 'alerts', 'pace'])
  })

  it("leaves a new install's default alone, as it never saved a dashboard", async () => {
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await types()).toEqual(defaultHome)
  })
})
