// Password hashing/verification (PBKDF2) and signed session cookies (HMAC-SHA256).
import { fromB64, toB64 } from './crypto'

const enc = new TextEncoder()
const dec = new TextDecoder()
// Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100000.
const MAX_ITERATIONS = 100000
const DEFAULT_ITERATIONS = 100000

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Produce a `pbkdf2$<iterations>$<saltB64>$<hashB64>` string. */
export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const iters = Math.min(iterations, MAX_ITERATIONS)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await deriveBits(password, salt, iters, 256)
  return `pbkdf2$${iters}$${toB64(salt)}$${toB64(bits)}`
}

/** Constant-time verification against a stored {@link hashPassword} string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string' || stored.length === 0) return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = fromB64(parts[2])
  const expected = fromB64(parts[3])
  const actual = await deriveBits(password, salt, iterations, expected.length * 8)
  return timingSafeEqual(actual, expected)
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBits: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    lengthBits,
  )
  return new Uint8Array(bits)
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

const WEEK_SECONDS = 60 * 60 * 24 * 7

/** Create a signed session token of the form `<payloadB64Url>.<sigB64Url>`. */
export async function createSessionToken(secret: string, ttlSeconds = WEEK_SECONDS): Promise<string> {
  const payload = { exp: Date.now() + ttlSeconds * 1000 }
  const body = toB64Url(enc.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  return `${body}.${toB64Url(sig)}`
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const key = await hmacKey(secret)
  let ok: boolean
  try {
    ok = await crypto.subtle.verify('HMAC', key, fromB64Url(sig), enc.encode(body))
  } catch {
    return false
  }
  if (!ok) return false
  try {
    const payload = JSON.parse(dec.decode(fromB64Url(body))) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}
