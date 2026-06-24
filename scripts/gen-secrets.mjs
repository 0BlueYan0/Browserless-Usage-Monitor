// Generates the three secrets the app needs, printed as .dev.vars lines on stdout.
// Usage:
//   node scripts/gen-secrets.mjs "your-dashboard-password" > .dev.vars
// Guidance is printed to stderr so stdout stays a clean dotenv file.
const password = process.argv[2]
const b64 = (buf) => Buffer.from(buf).toString('base64')

const encryptionKey = b64(crypto.getRandomValues(new Uint8Array(32)))
const sessionSecret = b64(crypto.getRandomValues(new Uint8Array(48)))

async function hashPassword(pw) {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterations = 100000 // Cloudflare Workers WebCrypto caps PBKDF2 at 100000
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`
}

if (!password) {
  console.error('ERROR: pass the dashboard password as the first argument.')
  console.error('  node scripts/gen-secrets.mjs "your-password" > .dev.vars')
  process.exit(1)
}

const hash = await hashPassword(password)
process.stdout.write(`ENCRYPTION_KEY="${encryptionKey}"\n`)
process.stdout.write(`APP_PASSWORD_HASH="${hash}"\n`)
process.stdout.write(`SESSION_SECRET="${sessionSecret}"\n`)

console.error('Generated secrets.')
console.error('For production set them with:')
console.error(`  echo "${encryptionKey}" | wrangler pages secret put ENCRYPTION_KEY`)
console.error(`  echo '${hash}' | wrangler pages secret put APP_PASSWORD_HASH`)
console.error(`  echo "${sessionSecret}" | wrangler pages secret put SESSION_SECRET`)
console.error('And give the cron Worker the SAME encryption key:')
console.error(`  echo "${encryptionKey}" | wrangler secret put ENCRYPTION_KEY -c worker/wrangler.toml`)
