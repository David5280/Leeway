import { describe, expect, it } from 'vitest'
import { isValidLocale } from '../src/lib/locale.js'

describe('isValidLocale', () => {
  it('accepts language tags', () => {
    for (const tag of ['en-US', 'de', 'pt-BR', 'zh-Hant-TW', 'en-us']) {
      expect(isValidLocale(tag)).toBe(true)
    }
  })

  it('refuses text that is not a language tag', () => {
    for (const tag of ['', 'not a locale', 'en_US!', '12']) {
      expect(isValidLocale(tag)).toBe(false)
    }
  })
})
