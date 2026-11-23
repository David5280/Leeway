// Real merchants still reach the model by name, and a search cannot confirm
// a hidden name by how many rows it finds, read from real rows through the
// tools. Every name is made up.

import { describe, expect, it } from 'vitest'
import { HIDDEN_SEARCH_MESSAGE } from '../src/chat/searchGuard.js'
import { GROCERIES, useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { pay } = probe

describe('real merchants', () => {
  it('show by name, a PayPal purchase at a shop the owner buys from too', async () => {
    await pay('STARBUCKS STORE 1234', 650, {
      merchantName: 'Starbucks',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })
    await pay('AMZN Mktp US*2K4', 2_999, {
      merchantName: 'Amazon',
      detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
    })
    await pay('NETFLIX.COM', 1_599, {
      merchantName: 'Netflix',
      detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
    })
    await pay('MARIGOLD CAFE', 1_200, {
      merchantName: 'Marigold Cafe',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })
    await pay('SPOTIFY USA', 1_199, { merchantName: 'Spotify', detailed: 'ENTERTAINMENT_MUSIC' })
    await pay('PAYPAL *SPOTIFY', 1_199, {
      merchantName: 'Spotify',
      detailed: 'ENTERTAINMENT_MUSIC',
    })

    expect((await probe.transactions()).map((tx) => tx.displayName).sort()).toEqual([
      'Amazon',
      'Marigold Cafe',
      'Netflix',
      'Spotify',
      'Spotify',
      'Starbucks',
    ])
    expect((await probe.merchants()).sort()).toEqual([
      'Amazon',
      'Marigold Cafe',
      'Netflix',
      'Spotify',
      'Starbucks',
    ])
  })
})

describe('a search', () => {
  it('is refused when it could find a hidden name or what a labelled row hides', async () => {
    await pay('Zelle payment to JANE PRYCEWOOD', 2_000, { note: 'concert tickets' })
    await pay('KING SOOPERS', 900, { merchantName: 'King Soopers', detailed: GROCERIES })

    for (const search of ['prycewood', 'Pryce']) {
      const result = await probe.run('list_transactions', { search })
      expect([search, result]).toEqual([
        search,
        { id: 'list_transactions', content: HIDDEN_SEARCH_MESSAGE, isError: true },
      ])
    }
    const preview = await probe.run('preview_rule', { pattern: 'PRYCEWOOD' })
    expect(preview.content).toBe(HIDDEN_SEARCH_MESSAGE)
    // A note is never searched, so a word only in one finds nothing.
    const concert = JSON.parse(await probe.sent('list_transactions', { search: 'concert' }))
    expect(concert.total).toBe(0)
  })

  it('runs for anything else, a label included', async () => {
    await pay('Zelle payment to JANE PRYCEWOOD', 2_000)
    await pay('KING SOOPERS', 900, { merchantName: 'King Soopers', detailed: GROCERIES })

    const found = (search: string) =>
      probe
        .sent('list_transactions', { search })
        .then((text) => JSON.parse(text) as { total: number })
    expect((await found('king')).total).toBe(1)
    expect(JSON.parse(await probe.sent('preview_rule', { pattern: 'soopers' }))).toMatchObject({
      matchCount: 1,
    })
    expect((await found('zelle')).total).toBe(0)
  })
})
