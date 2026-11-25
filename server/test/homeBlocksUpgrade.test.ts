// The new Home blocks reach every saved Home once: an older default, resized
// or not, moves to today's default, and a layout the owner arranged gains each
// missing card while keeping its order, sizes and hidden cards.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { addNewHomeBlocks, upgradeDefaultHome } from '../src/domain/dashboardUpgrade.js'
import { OLDER_DEFAULTS } from '../src/domain/homeLayouts.js'
import { DEFAULT_WIDGETS } from '../src/domain/settings.js'
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

/** Stores a dashboard as an older Leeway saved it, removed card kinds and all. */
async function storeWidgets(widgets: object[]): Promise<void> {
  await ctx.db.query(
    `UPDATE settings SET data = jsonb_set(data, '{dashboard}', jsonb_build_object('widgets', $1::jsonb))`,
    [JSON.stringify(widgets)],
  )
}

/** Marks an upgrade as run by an earlier start. */
async function alreadyApplied(name: string): Promise<void> {
  await ctx.db.query('INSERT INTO applied_upgrades (name) VALUES ($1)', [name])
}

const widgets = async () => (await call('get_settings')).dashboard.widgets
const types = async () => (await widgets()).map((w) => w.type)

const card = (type: string, size: string, visible = true) => ({ type, size, visible })

/** The three blocks as they are added: shown, at their default sizes. */
const newBlocks = [
  card('account-list', 'wide'),
  card('coming-up', 'half'),
  card('latest-activity', 'half'),
]

describe('addNewHomeBlocks on an older default', () => {
  it("gives the owner's install, Leeway resized to half, today's default Home", async () => {
    // The default just before Home followed the map, with only Leeway resized.
    await alreadyApplied('home-accounts')
    await storeWidgets([
      card('leeway', 'half'),
      card('net-worth', 'half'),
      card('alerts', 'full'),
      card('flows', 'full'),
      card('pace', 'full'),
    ])
    expect(await upgradeDefaultHome(ctx.db)).toBe(false)
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await widgets()).toEqual(DEFAULT_WIDGETS)
  })

  it.each(OLDER_DEFAULTS.map((layout, i) => [i, layout] as const))(
    'moves older default %i with one card resized',
    async (_, layout) => {
      await alreadyApplied('home-accounts')
      const resized = layout.map((w, i) => (i === 0 ? { ...w, size: 'half' } : w))
      await storeWidgets(resized)
      expect(await addNewHomeBlocks(ctx.db)).toBe(true)
      expect(await widgets()).toEqual(DEFAULT_WIDGETS)
    },
  )

  it('leaves the default Home that upgradeDefaultHome just gave as it is', async () => {
    await storeWidgets([...OLDER_DEFAULTS.at(-1)!])
    expect(await upgradeDefaultHome(ctx.db)).toBe(true)
    expect(await addNewHomeBlocks(ctx.db)).toBe(false)
    expect(await widgets()).toEqual(DEFAULT_WIDGETS)
  })
})

describe('addNewHomeBlocks on a layout the owner arranged', () => {
  /** The map order with net worth moved up and goals made wide. */
  const rearranged = [
    card('leeway', 'wide'),
    card('alerts', 'full'),
    card('net-worth', 'half'),
    card('cash-flow', 'half'),
    card('pace', 'half'),
    card('goals', 'wide'),
  ]

  it('adds the three blocks after Leeway and Heads up, keeping order and sizes', async () => {
    await storeWidgets(rearranged)
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await widgets()).toEqual([
      ...rearranged.slice(0, 2),
      ...newBlocks,
      ...rearranged.slice(2),
    ])
  })

  it('adds no tab row beside single tab cards, even hidden ones', async () => {
    const hiddenTab = [card('leeway', 'wide'), card('alerts', 'full'), card('pace', 'half', false)]
    await storeWidgets(hiddenTab)
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await types()).toEqual(['leeway', 'alerts', ...newBlocks.map((w) => w.type), 'pace'])
  })

  it('adds the tab row at the end when no tab card is there', async () => {
    await storeWidgets([card('leeway', 'wide'), card('alerts', 'full'), card('trends', 'half')])
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await widgets()).toEqual([
      card('leeway', 'wide'),
      card('alerts', 'full'),
      ...newBlocks,
      card('trends', 'half'),
      card('tab-row', 'full'),
    ])
  })

  it('adds no second copy of a block the owner hid', async () => {
    const layout = [
      card('leeway', 'wide'),
      card('alerts', 'full'),
      card('goals', 'half'),
      card('account-list', 'full', false),
    ]
    await storeWidgets(layout)
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await widgets()).toEqual([
      ...layout.slice(0, 2),
      card('coming-up', 'half'),
      card('latest-activity', 'half'),
      ...layout.slice(2),
    ])
  })

  it('changes nothing when every new card is already there', async () => {
    const hiddenRow = DEFAULT_WIDGETS.map((w) =>
      w.type === 'tab-row' ? { ...w, visible: false } : w,
    )
    await storeWidgets(hiddenRow)
    expect(await addNewHomeBlocks(ctx.db)).toBe(false)
    expect(await widgets()).toEqual(hiddenRow)
  })

  it('leaves removed kinds out of the layout it saves', async () => {
    await storeWidgets([card('leeway', 'wide'), card('glance', 'half'), card('alerts', 'full')])
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await types()).toEqual(DEFAULT_WIDGETS.map((w) => w.type))
  })
})

describe('addNewHomeBlocks runs once', () => {
  it('does nothing on a second start, even with the old layout put back', async () => {
    const layout = [card('leeway', 'wide'), card('alerts', 'full'), card('goals', 'half')]
    await storeWidgets(layout)
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    await storeWidgets(layout)
    expect(await addNewHomeBlocks(ctx.db)).toBe(false)
    expect(await widgets()).toEqual(layout)
  })

  it('runs on an install where the "home-accounts" upgrade already ran', async () => {
    await alreadyApplied('home-accounts')
    await storeWidgets([card('leeway', 'wide'), card('alerts', 'full')])
    expect(await addNewHomeBlocks(ctx.db)).toBe(true)
    expect(await types()).toEqual(DEFAULT_WIDGETS.map((w) => w.type))
  })

  it("leaves a new install's default alone, as it never saved a dashboard", async () => {
    expect(await addNewHomeBlocks(ctx.db)).toBe(false)
    expect(await widgets()).toEqual(DEFAULT_WIDGETS)
  })
})
