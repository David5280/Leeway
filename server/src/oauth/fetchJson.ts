// A small, careful HTTPS GET for JSON documents published by other servers.

import https from 'node:https'
import { checkAddressLiteral, publicOnlyLookup } from '../lib/publicAddress.js'

export interface FetchJsonOptions {
  /** The most the whole fetch may take, from connecting to the last byte. */
  timeoutMs: number
  /** Larger answers are cut off and refused, so a hostile server cannot exhaust memory. */
  maxBytes: number
  /** Swappable for tests, which serve documents over plain http on this computer. */
  transport?: Pick<typeof https, 'get'>
  lookup?: typeof publicOnlyLookup
}

/**
 * Fetches and parses one JSON document. Redirects are not followed and only a
 * 200 counts, so the document always comes from the exact URL asked for.
 * Connections only go to public addresses (see publicAddress.ts).
 */
export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const { transport = https, lookup = publicOnlyLookup } = options
  await checkAddressLiteral(url, lookup)
  return new Promise((resolve, reject) => {
    const tooLong = () => new Error(`${url} took too long to answer`)
    const request = transport.get(
      url,
      { lookup, timeout: options.timeoutMs, headers: { accept: 'application/json' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`${url} answered ${response.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > options.maxBytes) {
            // Settle first, then stop reading; a promise settles only once, so the rest is ignored.
            reject(new Error(`${url} is larger than ${options.maxBytes} bytes`))
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error(`${url} is not valid JSON`))
          }
        })
      },
    )
    // The socket timeout only notices silence; a server sending a byte at a
    // time would never trip it, so the whole fetch also has a deadline.
    const deadline = setTimeout(() => request.destroy(tooLong()), options.timeoutMs)
    request.on('close', () => clearTimeout(deadline))
    request.on('timeout', () => request.destroy(tooLong()))
    request.on('error', reject)
  })
}
