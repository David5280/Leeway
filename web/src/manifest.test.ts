// The install manifest an iPhone or Android reads when Leeway is added to the
// home screen.

import { describe, expect, it } from 'vitest'
import manifestText from '../public/manifest.webmanifest?raw'

const manifest = JSON.parse(manifestText) as Record<string, unknown>

describe('the install manifest', () => {
  it('opens as an app of its own, without the browser around it', () => {
    expect(manifest.display).toBe('standalone')
  })

  it('turns with the phone instead of locking it upright', () => {
    expect(manifest.orientation).toBe('any')
  })
})
