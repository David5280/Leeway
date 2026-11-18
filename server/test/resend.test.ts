import { describe, expect, it } from 'vitest'
import { RESEND_URL, ResendSender } from '../src/mail/resend.js'
import { MailError, type EmailMessage } from '../src/mail/sender.js'

const config = { apiKey: 're_test_key', from: 'Leeway <leeway@example.com>' }
const message: EmailMessage = {
  to: 'me@example.com',
  subject: 'Your week',
  html: '<p>Hi</p>',
  text: 'Hi',
}

/** A fetch that records each request and answers with `respond`. */
function fakeFetch(respond: (init: RequestInit) => Promise<Response> | Response) {
  const requests: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return respond(init)
  }) as typeof fetch
  return { fetchFn, requests }
}

/** Sends and returns the MailError it failed with. */
async function failure(sender: ResendSender): Promise<MailError> {
  const error: unknown = await sender.send(message).then(
    () => null,
    (failed: unknown) => failed,
  )
  expect(error).toBeInstanceOf(MailError)
  return error as MailError
}

describe('ResendSender', () => {
  it('posts the email to Resend as JSON with the key as a bearer token', async () => {
    const { fetchFn, requests } = fakeFetch(() => Response.json({ id: 'email-1' }))
    const sender = new ResendSender(config, fetchFn)
    await sender.send(message)

    expect(sender.name).toBe('Resend')
    expect(requests).toHaveLength(1)
    const { url, init } = requests[0]!
    expect(url).toBe(RESEND_URL)
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Leeway <leeway@example.com>',
      to: ['me@example.com'],
      subject: 'Your week',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes on why Resend refused, such as an unverified domain', async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json(
        {
          statusCode: 403,
          name: 'validation_error',
          message: 'The example.com domain is\nnot verified.',
        },
        { status: 403 },
      ),
    )
    expect((await failure(new ResendSender(config, fetchFn))).message).toBe(
      'Resend refused the email (403): The example.com domain is not verified.',
    )
  })

  it('says only the status when a refusal has no message', async () => {
    const { fetchFn } = fakeFetch(() => new Response('not json', { status: 422 }))
    expect((await failure(new ResendSender(config, fetchFn))).message).toBe(
      'Resend refused the email (422)',
    )
  })

  it('never repeats the key, and keeps a long message short', async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json(
        { message: `API key re_test_key is invalid. ${'x'.repeat(500)}` },
        { status: 401 },
      ),
    )
    const { message: text } = await failure(new ResendSender(config, fetchFn))
    expect(text).not.toContain('re_test_key')
    expect(text).toContain('API key [key] is invalid.')
    expect(text.length).toBeLessThan(260)
  })

  it('explains rate limits and Resend’s own trouble in plain words', async () => {
    const limited = fakeFetch(() => new Response('', { status: 429 }))
    expect((await failure(new ResendSender(config, limited.fetchFn))).message).toMatch(
      /limiting how fast/,
    )
    const broken = fakeFetch(() => new Response('', { status: 503 }))
    expect((await failure(new ResendSender(config, broken.fetchFn))).message).toBe(
      'Resend had a problem on its side (503). Try again later.',
    )
  })

  it('says when Resend cannot be reached', async () => {
    const { fetchFn } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')))
    expect((await failure(new ResendSender(config, fetchFn))).message).toBe(
      'Leeway could not reach Resend: fetch failed',
    )
    const odd = fakeFetch(() => Promise.reject('socket closed'))
    expect((await failure(new ResendSender(config, odd.fetchFn))).message).toBe(
      'Leeway could not reach Resend: socket closed',
    )
  })

  it('gives up on a request that takes too long', async () => {
    // Never answers; only the timeout's abort ends the request.
    const { fetchFn } = fakeFetch(
      (init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    const sender = new ResendSender(config, fetchFn, 20)
    expect((await failure(sender)).message).toBe(
      'Resend did not answer within 0.02 seconds. Leeway will try again.',
    )
  })
})
