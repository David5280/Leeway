// The layout guard's clipped check (layout/clipped.ts): text and controls
// cut off by a box that hides its overflow, or spilling out of their own,
// each proven on a small page broken on purpose and on the same page fixed.

import { expect, test } from '@playwright/test'
import { fixture, found } from './layout-fixture'

test.use({ viewport: { width: 390, height: 844 } })

test.describe('clipped', () => {
  test('finds text cut off without an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 40px; overflow: hidden; white-space: nowrap">Surplus</div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<div> "Surplus" is cut off with no ellipsis'])
  })

  test('finds text cut off by an ancestor that hides its overflow', async ({ page }) => {
    await fixture(
      page,
      `<div class="box" style="width: 60px; overflow: hidden"><b style="white-space: nowrap">Heads up</b></div>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<b> "Heads up" is cut off by <div.box> "Heads up"',
    ])
  })

  test('finds text spilling out of its box', async ({ page }) => {
    await fixture(page, `<div style="width: 60px; white-space: nowrap">Categories</div>`)
    expect(await found(page, 'clipped')).toEqual(['<div> "Categories" spills out of its box'])
  })

  test('finds a picker cutting off its choice without an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<select style="width: 90px"><option>Subscriptions and services</option></select>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<select> "Subscriptions and services" cuts off "Subscriptions and services"',
    ])
  })

  test('finds a name its row squeezed to nothing, though it would end in an ellipsis', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="display: flex; width: 300px">
        <span style="flex: 0 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Spending pace</span>
        <button style="flex: none; width: 300px">Half</button>
      </div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<span> "Spending pace" is squeezed to 0px'])
  })

  test('finds an ellipsis that leaves only a letter or two', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Surplus</div>`,
    )
    expect(await found(page, 'clipped')).toEqual(['<div> "Surplus" is squeezed to 24px'])
  })

  test('finds lines cut off by a box too short for them', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 120px; height: 1.4em; overflow: hidden">Total spent this paycheck so far</div>`,
    )
    expect(await found(page, 'clipped')).toEqual([
      '<div> "Total spent this paycheck so far" is cut off at the bottom',
    ])
  })

  test('finds icon buttons a row that hides its overflow cuts short or out of view', async ({
    page,
  }) => {
    // A dashboard row whose move buttons are pushed right by `shift`, in a list that clips.
    const rows = (shift: number, overflow = 'hidden') =>
      `<div class="layout-rows" style="width: 300px; overflow: ${overflow}">
        <div style="display: flex; align-items: center; gap: 8px">
          <span style="flex: 1">Summary</span>
          <span style="position: relative; left: ${shift}px; display: flex; gap: 4px">
            <button aria-label="Move up" style="width: 44px; height: 44px"></button>
            <button aria-label="Move down" style="width: 44px; height: 44px"></button>
          </span>
        </div>
      </div>`
    await fixture(page, rows(160))
    expect(await found(page, 'clipped')).toEqual([
      '<button> "Move up" is cut off by <div.layout-rows> "Summary"',
      '<button> "Move down" is cut off by <div.layout-rows> "Summary"',
    ])
    await fixture(page, rows(20))
    expect(await found(page, 'clipped')).toEqual([
      '<button> "Move down" is cut off by <div.layout-rows> "Summary"',
    ])
    // In place, or in a list that scrolls them into reach, nothing is wrong.
    await fixture(page, rows(0))
    expect(await found(page, 'clipped')).toEqual([])
    await fixture(page, rows(160, 'auto'))
    expect(await found(page, 'clipped')).toEqual([])
  })

  test('leaves alone a control hidden on purpose or fixed over a box that clips', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="width: 100px; height: 40px; overflow: hidden">
        <input type="checkbox" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">
        <button style="visibility: hidden; margin-left: 200px">Hidden</button>
        <button style="position: fixed; left: 150px; top: 0">Floats</button>
      </div>`,
    )
    expect(await found(page, 'clipped')).toEqual([])
  })

  test('accepts lines a line clamp ends with an ellipsis', async ({ page }) => {
    await fixture(
      page,
      `<div style="width: 120px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden">Total spent this paycheck so far</div>`,
    )
    expect(await found(page, 'clipped')).toEqual([])
  })

  test('accepts an ellipsis, a row that scrolls sideways and a picker with an ellipsis', async ({
    page,
  }) => {
    await fixture(
      page,
      `<div style="width: 60px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">Surplus</div>
      <div style="width: 60px; overflow-x: auto; white-space: nowrap"><a href="#">Appearance</a></div>
      <select style="width: 90px; text-overflow: ellipsis"><option>Subscriptions and services</option></select>`,
    )
    expect(await found(page, 'clipped')).toEqual([])
  })
})
