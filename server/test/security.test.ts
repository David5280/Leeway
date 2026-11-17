import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { decrypt, encrypt, hashToken, randomToken } from '../src/lib/crypto.js'
import { hashPassword, verifyPassword } from '../src/lib/password.js'

const key = Buffer.alloc(32, 7)

describe('encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const secret = 'access-sandbox-1234'
    const stored = encrypt(secret, key)
    expect(stored).not.toContain(secret)
    expect(decrypt(stored, key)).toBe(secret)
  })

  it('refuses a tampered value or a wrong key', () => {
    const stored = encrypt('secret', key)
    const [v, iv, tag, data] = stored.split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0]! ^= 1
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow()
    expect(() => decrypt(stored, Buffer.alloc(32, 8))).toThrow()
  })

  it('makes unique tokens and stable hashes', () => {
    expect(randomToken('lw_')).toMatch(/^lw_[\w-]{43}$/)
    expect(randomToken()).not.toBe(randomToken())
    expect(hashToken('a')).toBe(hashToken('a'))
  })
})

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(stored.startsWith('scrypt:')).toBe(true)
    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('wrong password', stored)).toBe(false)
    expect(await verifyPassword('anything', 'garbage')).toBe(false)
  })
})

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', ENCRYPTION_KEY: 'ab'.repeat(32) }

  it('applies defaults and leaves Plaid off until both keys are set', () => {
    const config = loadConfig(base)
    expect(config.port).toBe(3000)
    expect(config.plaid).toBeNull()
    expect(config.databaseSsl).toBe(false)
    expect(loadConfig({ ...base, PLAID_CLIENT_ID: 'id' }).plaid).toBeNull()
  })

  it('builds the public URL from Railway and uses TLS for hosted databases', () => {
    const config = loadConfig({
      ...base,
      DATABASE_URL: 'postgres://u:p@db.example.com/db',
      RAILWAY_PUBLIC_DOMAIN: 'leeway.up.railway.app',
      PLAID_CLIENT_ID: 'id',
      PLAID_SECRET: 'secret',
    })
    expect(config.publicUrl).toBe('https://leeway.up.railway.app')
    expect(config.databaseSsl).toBe(true)
    expect(config.plaid).toMatchObject({ env: 'sandbox', countryCodes: ['US'] })
  })

  it('explains a bad encryption key', () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: 'short' })).toThrow(/openssl rand -hex 32/)
  })
})
