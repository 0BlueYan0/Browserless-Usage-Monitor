import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, fromB64, toB64 } from './crypto'
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from './session'

const newKey = () => toB64(crypto.getRandomValues(new Uint8Array(32)))

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64))
    expect(Array.from(fromB64(toB64(bytes)))).toEqual(Array.from(bytes))
  })
})

describe('encryptSecret/decryptSecret', () => {
  it('round-trips plaintext', async () => {
    const key = newKey()
    const secret = 'bl_live_abc123_TOKEN'
    const enc = await encryptSecret(secret, key)
    expect(enc).not.toContain(secret)
    expect(await decryptSecret(enc, key)).toBe(secret)
  })

  it('produces different ciphertext each time (random IV)', async () => {
    const key = newKey()
    const a = await encryptSecret('same', key)
    const b = await encryptSecret('same', key)
    expect(a).not.toBe(b)
  })

  it('fails to decrypt with the wrong key', async () => {
    const enc = await encryptSecret('secret', newKey())
    await expect(decryptSecret(enc, newKey())).rejects.toBeTruthy()
  })

  it('rejects a bad key length', async () => {
    await expect(encryptSecret('x', toB64(new Uint8Array(10)))).rejects.toThrow(/16, 24, or 32/)
  })
})

describe('password hashing', () => {
  it('verifies the correct password and rejects wrong ones', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('pbkdf2$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
  })
})

describe('session tokens', () => {
  it('creates and verifies a token', async () => {
    const secret = 'session-secret'
    const token = await createSessionToken(secret)
    expect(await verifySessionToken(token, secret)).toBe(true)
  })

  it('rejects a token signed with another secret', async () => {
    const token = await createSessionToken('secret-a')
    expect(await verifySessionToken(token, 'secret-b')).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await createSessionToken('secret', -10)
    expect(await verifySessionToken(token, 'secret')).toBe(false)
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionToken('secret')
    expect(await verifySessionToken(token + 'x', 'secret')).toBe(false)
  })
})
