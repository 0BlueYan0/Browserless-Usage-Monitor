// Pages Functions API (catch-all for /api/*), built with Hono.
import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { TokenInput, TokenPublic, TokenUsage, UsageResponse, UsageResult } from '../../shared/types'
import { encryptSecret, decryptSecret } from '../../shared/crypto'
import { createSessionToken, verifyPassword, verifySessionToken } from '../../shared/session'
import { computePeriod, computeProjectionFromDaily } from '../../shared/projection'
import { decryptTokenSecrets, fetchTokenUsage } from '../../shared/usage'
import {
  type TokenRow,
  deleteTokenRow,
  getDailyUsage,
  getTokenRow,
  insertTokenRow,
  listTokenRows,
  rowToRecord,
  updateTokenRow,
  upsertDailyUsage,
} from '../../shared/db'

interface Env {
  DB: D1Database
  ENCRYPTION_KEY: string
  APP_PASSWORD_HASH: string
  SESSION_SECRET: string
}

const SESSION_COOKIE = 'session'
const SESSION_TTL = 60 * 60 * 24 * 7
const DAY_MS = 24 * 60 * 60 * 1000

const app = new Hono<{ Bindings: Env }>()

// Public endpoints (no session required).
const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health'])

// --- Auth guard for everything under /api except the public endpoints ---
app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next()
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !(await verifySessionToken(token, c.env.SESSION_SECRET))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

// --- Diagnostics (public): reports which bindings/secrets are present, no values. ---
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    config: {
      DB: !!c.env.DB,
      ENCRYPTION_KEY: !!c.env.ENCRYPTION_KEY,
      APP_PASSWORD_HASH: !!c.env.APP_PASSWORD_HASH,
      SESSION_SECRET: !!c.env.SESSION_SECRET,
    },
  }),
)

// --- Auth ---
app.post('/api/auth/login', async (c) => {
  if (!c.env.APP_PASSWORD_HASH || !c.env.SESSION_SECRET) {
    return c.json(
      {
        error:
          'Server not configured: set APP_PASSWORD_HASH and SESSION_SECRET (Pages → Settings → Variables and Secrets), then redeploy.',
      },
      500,
    )
  }
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
    account_enc: null,
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

  await updateTokenRow(c.env.DB, id, set)
  const updated = await getTokenRow(c.env.DB, id)
  return c.json({ token: await toPublic(updated!, c.env) })
})

app.delete('/api/tokens/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM daily_usage WHERE token_id = ?').bind(id).run()
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
    hasAccountLogin: false,
  }
  try {
    const usage = await fetchTokenUsage(record, { apiToken: input.apiToken! })
    return c.json({ ok: true, weekUnits: usage.weekUnits, days: usage.daily.length })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message })
  }
})

// --- Usage overview ---
app.get('/api/usage', async (c) => {
  const rows = await listTokenRows(c.env.DB)
  const now = Date.now()
  const tokens = await Promise.all(rows.map((row) => buildTokenUsage(row, c.env, now)))

  const okTokens = tokens.filter((t) => t.status === 'ok' && t.projection)
  const totalUsed = okTokens.reduce((s, t) => s + (t.projection?.used ?? 0), 0)
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
    const usage = await fetchTokenUsage(rowToRecord(row), secrets)

    // Accumulate each day's bucket so the monthly total survives the 7-day API window.
    for (const b of usage.daily) {
      await upsertDailyUsage(env.DB, row.id, b, usage.fetchedAt)
    }

    // Read buckets back covering both the billing period and the trailing rate window.
    const since = Math.min(periodStart, now - 8 * DAY_MS)
    const daily = await getDailyUsage(env.DB, row.id, since)
    const projection = computeProjectionFromDaily({
      planLimit: row.plan_limit,
      daily,
      resetDay: row.reset_day,
      now,
    })
    const usageResult: UsageResult = {
      usedThisPeriod: projection.used,
      weekUnits: usage.weekUnits,
      periodStart,
      fetchedAt: usage.fetchedAt,
    }
    const sparkline = daily
      .filter((d) => d.dayStart >= periodStart)
      .map((d) => ({ capturedAt: d.dayStart, totalUnits: d.units }))
    return { token, usage: usageResult, projection, sparkline, status: 'ok' }
  } catch (err) {
    const daily = await getDailyUsage(env.DB, row.id, periodStart)
    return {
      token,
      usage: null,
      projection: null,
      sparkline: daily.map((d) => ({ capturedAt: d.dayStart, totalUnits: d.units })),
      status: 'error',
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

  return {
    value: {
      label,
      source: body.source,
      endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : null,
      apiToken: typeof body.apiToken === 'string' ? body.apiToken.trim() : undefined,
      planLimit,
      resetDay,
    },
  }
}
