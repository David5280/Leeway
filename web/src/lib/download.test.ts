import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv, downloadText, KEEP_URL_MS } from './download'

let saved: { name: string; href: string; blob: Blob }[]
let revoked: string[]

beforeEach(() => {
  vi.useFakeTimers()
  saved = []
  revoked = []
  let blob: Blob | null = null
  // jsdom has neither object URLs nor downloads; record what would be saved.
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blob = b as Blob
    return 'blob:file'
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.href, blob: blob! })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A blob's raw bytes: its text would drop a byte order mark while decoding. */
async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

describe('downloadText', () => {
  it('saves the text under its name, freeing the address only once the download has begun', async () => {
    downloadText('{"a":1}', 'leeway.json', 'application/json')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'leeway.json', href: 'blob:file' })
    expect(saved[0]!.blob.type).toBe('application/json')
    expect(await saved[0]!.blob.text()).toBe('{"a":1}')
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(KEEP_URL_MS)
    expect(revoked).toEqual(['blob:file'])
  })
})

describe('downloadCsv', () => {
  it('starts the file with a UTF-8 byte order mark, so Excel shows accented names', async () => {
    downloadCsv('Café\r\n', 'year.csv')
    const { blob, name } = saved[0]!
    expect(name).toBe('year.csv')
    expect(blob.type).toBe('text/csv')
    const bytes = await bytesOf(blob)
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(new Uint8Array(bytes.slice(3)))).toBe('Café\r\n')
  })
})
