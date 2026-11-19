// The install manifest a phone or computer reads when Leeway is added to its
// home screen or installed.

import { describe, expect, it } from 'vitest'
import manifestText from '../public/manifest.webmanifest?raw'

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
