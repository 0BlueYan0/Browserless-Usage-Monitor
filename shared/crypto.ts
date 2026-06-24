// AES-GCM encryption of secrets at rest, plus base64 helpers.
// Runs on both the Workers runtime and Node 22 (WebCrypto is global in both).

const IV_BYTES = 12

export function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64)
  if (raw.length !== 16 && raw.length !== 24 && raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 16, 24, or 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Encrypt plaintext, returning base64 of (iv || ciphertext). */
export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = new TextEncoder().encode(plaintext)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return toB64(out)
}

/** Decrypt a payload produced by {@link encryptSecret}. */
export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64)
  const bytes = fromB64(payload)
  const iv = bytes.slice(0, IV_BYTES)
  const ct = bytes.slice(IV_BYTES)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}
