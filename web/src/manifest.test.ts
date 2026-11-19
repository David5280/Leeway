// The install manifest a phone or computer reads when Leeway is added to its
// home screen or installed, and the icons it and the page point to.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import pageText from '../index.html?raw'
import manifestText from '../public/manifest.webmanifest?raw'
import serviceWorkerText from '../public/sw.js?raw'

const manifest = JSON.parse(manifestText) as Record<string, unknown>

describe('the install manifest', () => {
  it('opens as an app of its own, without the browser around it', () => {
    expect(manifest.display).toBe('standalone')
  })

  // Where a platform reads it (Android, desktop installs), "any" leaves the
  // app free to turn rather than locked upright. An iPhone ignores the field:
  // an installed app turns there unless rotation lock is on, so this changes
  // nothing on iOS.
  it('locks no orientation on platforms that read it', () => {
    expect(manifest.orientation).toBe('any')
  })
})

// An installed app keeps the icons it fetched at install time, and Chrome
// fetches them again on its manifest update check reliably only when an
// icon's URL changes. So every icon URL ends in ?v= and the first 8 hex digits
// of the file's SHA-256: change an icon and these tests fail until each link
// to it carries the new version.
describe('icon versions', () => {
  const publicDir = join(import.meta.dirname, '../public')
  const iconFiles = readdirSync(publicDir).filter((name) => /\.(png|svg|ico)$/.test(name))

  const versionOf = (file: string) =>
    createHash('sha256')
      .update(readFileSync(join(publicDir, file)))
      .digest('hex')
      .slice(0, 8)

  // A root-relative link to an image, with any query it carries.
  const ICON_URL = /\/[\w.-]+\.(?:png|svg|ico)(?:\?[^"'\s]*)?/g
  const linksIn = (text: string) => text.match(ICON_URL) ?? []

  // Everywhere the app names an icon by URL.
  const sources = {
    'manifest.webmanifest': linksIn(manifestText),
    'index.html': linksIn(pageText),
    'sw.js': linksIn(serviceWorkerText),
  }
  const links = Object.entries(sources).flatMap(([source, urls]) =>
    urls.map((url) => ({ source, url })),
  )

  it('finds the icons and the links to them', () => {
    expect(iconFiles).toEqual(
      expect.arrayContaining(['icon.svg', 'icon-192.png', 'apple-touch-icon.png']),
    )
    // Guards the pattern above: a link it failed to match would go unchecked.
    expect(sources['manifest.webmanifest']).toHaveLength(
      (manifest.icons as { src: string }[]).length,
    )
    expect(sources['index.html'].length).toBeGreaterThan(0)
  })

  it.each(links)('$source links $url at its current version', ({ url }) => {
    const file = new URL(url, 'https://leeway.test').pathname.slice(1)
    expect(iconFiles).toContain(file)
    expect(url).toBe(`/${file}?v=${versionOf(file)}`)
  })

  // An icon nothing links to is either dead weight or a link someone forgot.
  it.each(iconFiles)('links %s from the manifest or the page', (file) => {
    const installLinks = [...sources['manifest.webmanifest'], ...sources['index.html']]
    expect(installLinks).toContain(`/${file}?v=${versionOf(file)}`)
  })
})
