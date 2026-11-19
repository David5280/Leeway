import { describe, expect, it } from 'vitest'
import { withoutUuids } from './uuids.js'

describe('withoutUuids', () => {
  it('takes out a UUID whose digits look like a mask, so a mask check passes', () => {
    const text = '{"id":"9d43cbde-8405-4321-a1b2-0123456789ab","name":"Test Savings"}'
    expect(text).toMatch(/9876|4321/)
    expect(withoutUuids(text)).not.toMatch(/9876|4321/)
    expect(withoutUuids(text)).toBe('{"id":"<uuid>","name":"Test Savings"}')
  })

  it('leaves a mask written out, so the check still catches it', () => {
    const text = '{"id":"9d43cbde-8405-4321-a1b2-0123456789ab","name":"Savings ...4321"}'
    expect(withoutUuids(text)).toMatch(/9876|4321/)
  })

  it('takes out every UUID, in either case', () => {
    const text = 'a 9D43CBDE-8405-4321-A1B2-0123456789AB b 00000000-0000-4000-8000-000000004321'
    expect(withoutUuids(text)).toBe('a <uuid> b <uuid>')
  })
})
