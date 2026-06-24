// Pages Functions API (catch-all for /api/*), built with Hono.
import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { Projection, TokenInput, TokenPublic, TokenUsage, UsageResponse } from '../../shared/types'
import { encryptSecret, decryptSecret } from '../../shared/crypto'
import { createSessionToken, verifyPassword, verifySessionToken } from '../../shared/session'
import { computePeriod, computeProjection } from '../../shared/projection'
import { NeedsLoginError, fetchUsageForToken, decryptTokenSecrets } from '../../shared/usage'
import {
  type TokenRow,
  deleteTokenRow,
  getRecentSnapshots,
  getTokenRow,
  insertSnapshot,
  insertTokenRow,
  listTokenRows,
  rowToRecord,
  updateTokenRow,
} from '../../shared/db'

interface Env {
  DB: D1Database
  ENCRYPTION_KEY: string
  APP_PASSWORD_HASH: string
  SESSION_SECRET: string
}

const SESSION_COOKIE = 'session'
const SESSION_TTL = 60 * 60 * 24 * 7

const app = new Hono<{ Bindings: Env }>()

// --- Auth guard for everything under /api except the login endpoint ---
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login') return next()
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !(await verifySessionToken(token, c.env.SESSION_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

// --- Auth ---
app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ password?: string }>(c)
  const password = body?.password
  if (!password || !(await verifyPassword(password, c.env.APP_PASSWORD_HASH))) {
    return c.json({ error: 'invalid password' }, 401)
  }
  const token = await createSessionToken(c.env.SESSION_SECRET, SESSION_TTL)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  })
  return c.json({ ok: true })
})

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/auth/me', (c) => c.json({ authenticated: true }))

// --- Tokens CRUD ---
app.get('/api/tokens', async (c) => {
  const rows = await listTokenRows(c.env.DB)
  const tokens = await Promise.all(rows.map((r) => toPublic(r, c.env)))
  return c.json({ tokens })
})

app.post('/api/tokens', async (c) => {
  const body = await readJson<TokenInput>(c)
  const parsed = validateTokenInput(body, { requireApiToken: true })
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const input = parsed.value

  const now = Date.now()
  const rows = await listTokenRows(c.env.DB)
  const row: TokenRow = {
    id: crypto.randomUUID(),
    label: input.label,
    source: input.source,
    endpoint_url: input.source === 'self-hosted' ? input.endpointUrl ?? null : null,
    api_token_enc: await encryptSecret(input.apiToken!, c.env.ENCRYPTION_KEY),
    account_enc: input.account
      ? await encryptSecret(JSON.stringify(input.account), c.env.ENCRYPTION_KEY)
      : null,
    plan_limit: input.planLimit,
    reset_day: input.resetDay,
    sort_order: rows.length,
    created_at: now,
    updated_at: now,
  }
  await insertTokenRow(c.env.DB, row)
  return c.json({ token: await toPublic(row, c.env) }, 201)
})

app.put('/api/tokens/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await getTokenRow(c.env.DB, id)
  if (!existing) return c.json({ error: 'not found' }, 404)

  const body = await readJson<TokenInput>(c)
  const parsed = validateTokenInput(body, { requireApiToken: false })
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const input = parsed.value

  const set: Partial<Omit<TokenRow, 'id'>> = {
    label: input.label,
    source: input.source,
    endpoint_url: input.source === 'self-hosted' ? input.endpointUrl ?? null : null,
    plan_limit: input.planLimit,
    reset_day: input.resetDay,
    updated_at: Date.now(),
  }
  if (input.apiToken) {
    set.api_token_enc = await encryptSecret(input.apiToken, c.env.ENCRYPTION_KEY)
  }
  if (input.account === null) {
    set.account_enc = null
  } else if (input.account) {
    set.account_enc = await encryptSecret(JSON.stringify(input.account), c.env.ENCRYPTION_KEY)
  }

  await updateTokenRow(c.env.DB, id, set)
  const updated = await getTokenRow(c.env.DB, id)
  return c.json({ token: await toPublic(updated!, c.env) })
})

app.delete('/api/tokens/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM snapshots WHERE token_id = ?').bind(id).run()
  await deleteTokenRow(c.env.DB, id)
  return c.json({ ok: true })
})

// Test a token's connection without saving it.
app.post('/api/tokens/test', async (c) => {
  const body = await readJson<TokenInput>(c)
  const parsed = validateTokenInput(body, { requireApiToken: true })
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const input = parsed.value
  const record = {
    id: 'test',
    label: input.label,
    source: input.source,
    endpointUrl: input.endpointUrl ?? null,
    planLimit: input.planLimit,
    resetDay: input.resetDay,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    hasAccountLogin: !!input.account,
  }
  try {
    const usage = await fetchUsageForToken(record, {
      apiToken: input.apiToken!,
      account: input.account ?? undefined,
    })
    return c.json({ ok: true, usage })
  } catch (err) {
    if (err instanceof NeedsLoginError) {
      return c.json({ ok: false, status: 'needs-login', error: err.message })
    }
    return c.json({ ok: false, status: 'error', error: (err as Error).message })
  }
})

// --- Usage overview ---
app.get('/api/usage', async (c) => {
  const rows = await listTokenRows(c.env.DB)
  const now = Date.now()
  const tokens = await Promise.all(rows.map((row) => buildTokenUsage(row, c.env, now)))

  const okTokens = tokens.filter((t) => t.status === 'ok' && t.projection)
  const totalUsed = okTokens.reduce((s, t) => s + (t.usage?.totalUnitsUsed ?? 0), 0)
  const totalLimit = tokens.reduce((s, t) => s + t.token.planLimit, 0)

  let soonestExhaustionTokenId: string | null = null
  let soonestDaysRemaining: number | null = null
  for (const t of okTokens) {
    const d = t.projection!.daysUntilExhausted
    if (d !== null && (soonestDaysRemaining === null || d < soonestDaysRemaining)) {
      soonestDaysRemaining = d
      soonestExhaustionTokenId = t.token.id
    }
  }

  const response: UsageResponse = {
    tokens,
    aggregate: {
      totalUsed,
      totalLimit,
      percentUsed: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
      soonestExhaustionTokenId,
      soonestDaysRemaining,
    },
  }
  return c.json(response)
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  console.error('api error', err)
  return c.json({ error: 'internal error' }, 500)
})

export const onRequest = handle(app)

// --- helpers ---

async function buildTokenUsage(row: TokenRow, env: Env, now: number): Promise<TokenUsage> {
  const token = await toPublic(row, env)
  const { start: periodStart } = computePeriod(row.reset_day, now)
  try {
    const secrets = await decryptTokenSecrets(row, env.ENCRYPTION_KEY)
    const record = rowToRecord(row)
    const usage = await fetchUsageForToken(record, secrets, now)

    // Record a snapshot so burn-rate improves over time (manual refresh contributes too),
    // but throttle to avoid bloating the table on frequent dashboard polls.
    const existing = await getRecentSnapshots(env.DB, row.id, periodStart)
    const last = existing[existing.length - 1]
    const SNAPSHOT_THROTTLE_MS = 30 * 60 * 1000
    let snapshots = existing
    if (!last || usage.fetchedAt - last.capturedAt >= SNAPSHOT_THROTTLE_MS) {
      await insertSnapshot(env.DB, {
        tokenId: row.id,
        capturedAt: usage.fetchedAt,
        periodStart,
        totalUnits: usage.totalUnitsUsed,
        timeUnits: usage.timeUnits,
        proxyUnits: usage.proxyUnits,
        captchaUnits: usage.captchaUnits,
      })
      snapshots = [...existing, { capturedAt: usage.fetchedAt, totalUnits: usage.totalUnitsUsed }]
    }

    const projection: Projection = computeProjection({
      planLimit: row.plan_limit,
      used: usage.totalUnitsUsed,
      resetDay: row.reset_day,
      now,
      snapshots,
    })
    return { token, usage, projection, sparkline: snapshots, status: 'ok' }
  } catch (err) {
    const status = err instanceof NeedsLoginError ? 'needs-login' : 'error'
    const snapshots = await getRecentSnapshots(env.DB, row.id, periodStart)
    return {
      token,
      usage: null,
      projection: null,
      sparkline: snapshots,
      status,
      error: (err as Error).message,
    }
  }
}

async function toPublic(row: TokenRow, env: Env): Promise<TokenPublic> {
  let mask = '••••'
  try {
    const apiToken = await decryptSecret(row.api_token_enc, env.ENCRYPTION_KEY)
    mask = '••••' + apiToken.slice(-4)
  } catch {
    // leave default mask if decryption fails
  }
  return { ...rowToRecord(row), tokenMask: mask }
}

async function readJson<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

type ValidationResult =
  | { value: Required<Pick<TokenInput, 'label' | 'source' | 'planLimit' | 'resetDay'>> & TokenInput }
  | { error: string }

function validateTokenInput(
  body: TokenInput | null,
  opts: { requireApiToken: boolean },
): ValidationResult {
  if (!body || typeof body !== 'object') return { error: 'invalid body' }
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return { error: 'label is required' }
  if (body.source !== 'cloud' && body.source !== 'self-hosted') {
    return { error: 'source must be "cloud" or "self-hosted"' }
  }
  if (body.source === 'self-hosted') {
    const url = typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : ''
    if (!url || !/^https?:\/\//.test(url)) return { error: 'self-hosted requires a valid endpoint URL' }
  }
  const planLimit = Number(body.planLimit)
  if (!Number.isFinite(planLimit) || planLimit <= 0) return { error: 'planLimit must be > 0' }
  const resetDay = Number(body.resetDay)
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 28) {
    return { error: 'resetDay must be an integer 1..28' }
  }
  if (opts.requireApiToken && (typeof body.apiToken !== 'string' || !body.apiToken.trim())) {
    return { error: 'apiToken is required' }
  }
  let account = body.account
  if (account !== undefined && account !== null) {
    if (typeof account.email !== 'string' || typeof account.password !== 'string' || !account.email || !account.password) {
      return { error: 'account login requires both email and password' }
    }
    account = { email: account.email.trim(), password: account.password }
  }

  return {
    value: {
      label,
      source: body.source,
      endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : null,
      apiToken: typeof body.apiToken === 'string' ? body.apiToken.trim() : undefined,
      account,
      planLimit,
      resetDay,
    },
  }
}
