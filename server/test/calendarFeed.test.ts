import { describe, expect, it, vi } from 'vitest'
import {
  calendarUrl,
  FETCH_TIMEOUT_MS,
  fetchCalendar,
  MAX_CALENDAR_BYTES,
  type Fetcher,
} from '../src/domain/calendar/feed.js'
import { AppError } from '../src/errors.js'

const SECRET = 'https://calendar.example.com/private-abc123/basic.ics'
const CALENDAR = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

/** A fetch that answers this body and status, from this final address. */
function answering(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit = {},
  url = SECRET,
): Fetcher {
  return async () => {
    const response = new Response(body, init)
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppError)
  // The link is a secret: no failure ever repeats it.
  expect((error as AppError).message).not.toContain('private-abc123')
  return error as AppError
}

describe('calendarUrl', () => {
  it('takes an https link, and a webcal link as the same address over https', () => {
    expect(calendarUrl(` ${SECRET} `).href).toBe(SECRET)
    expect(calendarUrl('webcal://p01-caldav.icloud.com/published/2/abc').href).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    )
    expect(calendarUrl('WEBCALS://example.com/a.ics').protocol).toBe('https:')
  })

  it('refuses what is not a link, plain http, and links into the local network', () => {
    const refused = (pasted: string) => {
      try {
        calendarUrl(pasted)
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_input' })
        return (error as Error).message
      }
      throw new Error(`${pasted} was taken`)
    }
    expect(refused('my calendar')).toMatch(/not a link/)
    expect(refused('http://calendar.example.com/a.ics')).toMatch(/secure/)
    expect(refused('ftp://calendar.example.com/a.ics')).toMatch(/secure/)
    for (const host of [
      'localhost',
      '127.0.0.1',
      '10.0.0.2',
      '192.168.1.9',
      '172.20.0.1',
      '169.254.169.254',
      '[::1]',
      'printer.local',
      'db.internal',
    ]) {
      expect(refused(`https://${host}/a.ics`)).toMatch(/inside your own network/)
    }
    expect(calendarUrl('https://172.32.0.1/a.ics').hostname).toBe('172.32.0.1')
  })
})

describe('fetchCalendar', () => {
  it('asks for the calendar with a time limit, and returns its text', async () => {
    const fetcher = vi.fn(answering(CALENDAR))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    expect(await fetchCalendar(new URL(SECRET), fetcher)).toBe(CALENDAR)
    expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
    expect(fetcher).toHaveBeenCalledWith(SECRET, expect.objectContaining({ redirect: 'follow' }))
    timeout.mockRestore()
  })

  it('says plainly when the calendar does not answer', async () => {
    const error = await failure(
      fetchCalendar(new URL(SECRET), async () => {
        throw new TypeError(`fetch failed for ${SECRET}`)
      }),
    )
    expect(error).toMatchObject({ code: 'calendar_error', status: 502 })
    expect(error.message).toMatch(/did not answer/)
  })

  it('refuses a redirect off https', async () => {
    const error = await failure(
      fetchCalendar(new URL(SECRET), answering(CALENDAR, {}, 'http://calendar.example.com/a.ics')),
    )
    expect(error.message).toMatch(/not secure/)
  })

  it('tells a refused link apart from a calendar that is down', async () => {
    for (const status of [401, 403, 404]) {
      const error = await failure(fetchCalendar(new URL(SECRET), answering('no', { status })))
      expect(error.message).toMatch(/refused that link/)
    }
    const down = await failure(fetchCalendar(new URL(SECRET), answering('no', { status: 503 })))
    expect(down.message).toMatch(/try again later/i)
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

  it('refuses what is not a calendar, an empty answer included', async () => {
    const page = await failure(fetchCalendar(new URL(SECRET), answering('<html>Sign in</html>')))
    expect(page.message).toMatch(/not a calendar/)
    await failure(fetchCalendar(new URL(SECRET), answering(null)))
  })

  it('uses the global fetch when given none', async () => {
    const reply = answering(CALENDAR, {}, '')
    const real = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => reply(String(input), init ?? {}))
    expect(await fetchCalendar(new URL(SECRET))).toBe(CALENDAR)
    real.mockRestore()
  })
})
