// Fetching a linked calendar: which links are taken, and how a fetch follows
// redirects, keeps to its limits and says plainly why it failed.

import { describe, expect, it, vi } from 'vitest'
import {
  calendarUrl,
  FETCH_TIMEOUT_MS,
  fetchCalendar,
  isLocalHost,
  MAX_CALENDAR_BYTES,
  MAX_REDIRECTS,
  NO_ANSWER,
  type Fetcher,
} from '../src/domain/calendar/feed.js'
import { CALENDAR, failure, SECRET } from './fixtures/calendarFetch.js'

/** A fetch that answers this body and status. */
function answering(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit = {},
): Fetcher {
  return async () => new Response(body, init)
}

/** A fetch that answers each address from this table, a redirect where it says so. */
function routes(table: Record<string, string | { moved: string | null }>) {
  return vi.fn<Fetcher>(async (url) => {
    const route = table[url]
    if (route === undefined) throw new Error(`asked ${url}`)
    if (typeof route === 'string') return new Response(route)
    const headers: Record<string, string> = route.moved === null ? {} : { location: route.moved }
    return new Response(null, { status: 302, headers })
  })
}

describe('calendarUrl', () => {
  const refused = (pasted: string) => {
    try {
      calendarUrl(pasted)
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_input' })
      return (error as Error).message
    }
    throw new Error(`${pasted} was taken`)
  }

  it('takes an https link, and a webcal link as the same address over https', () => {
    expect(calendarUrl(` ${SECRET} `).href).toBe(SECRET)
    expect(calendarUrl('webcal://p01-caldav.icloud.com/published/2/abc').href).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    )
    expect(calendarUrl('WEBCALS://example.com/a.ics').protocol).toBe('https:')
  })

  it('refuses what is not a link, and plain http', () => {
    expect(refused('my calendar')).toMatch(/not a link/)
    expect(refused('http://calendar.example.com/a.ics')).toMatch(/secure/)
    expect(refused('ftp://calendar.example.com/a.ics')).toMatch(/secure/)
  })

  it('refuses links into this machine or its network, however the address is written', () => {
    for (const host of [
      'localhost',
      'localhost.',
      'app.localhost',
      '127.0.0.1',
      '2130706433',
      '10.0.0.2',
      '192.168.1.9',
      '172.20.0.1',
      '169.254.169.254',
      '100.100.100.200',
      '0.0.0.0',
      '[::1]',
      '[::]',
      '[::ffff:127.0.0.1]',
      '[fd00::1]',
      '[fe80::1]',
      '[fec0::1]',
      '192.88.99.1',
      'printer.local',
      'db.internal',
    ]) {
      expect(refused(`https://${host}/a.ics`)).toMatch(/inside your own network/)
    }
  })

  it('takes public names that only look local at first sight', () => {
    for (const host of [
      'localhostcalendar.com',
      '10.example.com',
      'internal.example.com',
      'local.example.org',
      '172.32.0.1',
      '[2606:4700::1111]',
    ]) {
      expect(isLocalHost(calendarUrl(`https://${host}/a.ics`).hostname)).toBe(false)
    }
  })
})

describe('fetchCalendar', () => {
  it('asks for the calendar with one time limit, and returns its text', async () => {
    const fetcher = vi.fn(answering(CALENDAR))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    expect(await fetchCalendar(new URL(SECRET), fetcher)).toBe(CALENDAR)
    expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
    expect(fetcher).toHaveBeenCalledWith(
      SECRET,
      expect.objectContaining({ redirect: 'manual', headers: { Accept: 'text/calendar' } }),
    )
    timeout.mockRestore()
  })

  it('says plainly when the calendar does not answer', async () => {
    const error = await failure(
      fetchCalendar(new URL(SECRET), async () => {
        throw new TypeError(`fetch failed for ${SECRET}`)
      }),
    )
    expect(error).toMatchObject({ code: 'calendar_error', status: 502, message: NO_ANSWER })
  })

  it('follows a few redirects, relative ones included, checking each before asking it', async () => {
    const fetcher = routes({
      [SECRET]: { moved: 'https://cdn.example.net/cal.ics' },
      'https://cdn.example.net/cal.ics': { moved: '/final.ics' },
      'https://cdn.example.net/final.ics': CALENDAR,
    })
    expect(await fetchCalendar(new URL(SECRET), fetcher)).toBe(CALENDAR)
    const signals = fetcher.mock.calls.map(([, init]) => init.signal)
    expect(new Set(signals).size).toBe(1)
  })

  it('never asks an address a redirect points off https or into this network', async () => {
    const cases: [string, RegExp | string][] = [
      ['http://127.0.0.1/internal-secret', /not secure/],
      ['https://127.0.0.1/internal-secret', NO_ANSWER],
      ['https://[::ffff:127.0.0.1]/', NO_ANSWER],
      ['https://100.100.100.200/', NO_ANSWER],
      ['https://metadata.internal/', NO_ANSWER],
    ]
    for (const [moved, message] of cases) {
      const fetcher = routes({ [SECRET]: { moved } })
      const error = await failure(fetchCalendar(new URL(SECRET), fetcher))
      expect(error.message).toMatch(message)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after MAX_REDIRECTS, and on a redirect that says nowhere', async () => {
    const loop = routes({ [SECRET]: { moved: SECRET } })
    expect((await failure(fetchCalendar(new URL(SECRET), loop))).message).toMatch(/too many/)
    expect(loop).toHaveBeenCalledTimes(MAX_REDIRECTS + 1)
    for (const moved of [null, 'https://[broken']) {
      const fetcher = routes({ [SECRET]: { moved } })
      const error = await failure(fetchCalendar(new URL(SECRET), fetcher))
      expect(error.message).toMatch(/could not be read/)
    }
  })

  it('tells a refused link apart from a calendar that is down', async () => {
    for (const status of [401, 403, 404]) {
      const error = await failure(fetchCalendar(new URL(SECRET), answering('no', { status })))
      expect(error.message).toMatch(/refused that link/)
    }
    const down = await failure(fetchCalendar(new URL(SECRET), answering('no', { status: 503 })))
    expect(down.message).toMatch(/try again later/i)
    const bare = await failure(fetchCalendar(new URL(SECRET), answering(null, { status: 500 })))
    expect(bare.message).toMatch(/try again later/i)
  })

  it('refuses a calendar over the size cap rather than cut it off', async () => {
    const chunk = new Uint8Array(512 * 1024).fill(65)
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const error = await failure(fetchCalendar(new URL(SECRET), answering(endless)))
    expect(error.message).toMatch(/too large/)
    // It stopped reading soon after the cap.
    expect(sent).toBeLessThan(MAX_CALENDAR_BYTES + 2 * chunk.byteLength)
  })

  it('takes a body cut off by the time limit as no answer, not a crash', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'))
      },
      pull(controller) {
        controller.error(new DOMException('This operation was aborted', 'AbortError'))
      },
    })
    const error = await failure(fetchCalendar(new URL(SECRET), answering(cut)))
    expect(error.message).toBe(NO_ANSWER)
  })

  it('refuses what is not a calendar, an empty answer included', async () => {
    const page = await failure(fetchCalendar(new URL(SECRET), answering('<html>Sign in</html>')))
    expect(page.message).toMatch(/not a calendar/)
    await failure(fetchCalendar(new URL(SECRET), answering(null)))
  })

  it('connects only to public addresses when given no fetch of its own', async () => {
    const error = await failure(fetchCalendar(new URL('https://127.0.0.1:1/a.ics')))
    expect(error.message).toBe(NO_ANSWER)
  })
})
