// Pages Functions API (catch-all for /api/*), built with Hono.
import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type {
  TokenInput,
  TokenPublic,
  TokenSource,
  TokenUsage,
  UsageResponse,
  UsageResult,
} from '../../shared/types'
// (projection type is inferred from computeProjectionFromDaily)
import { encryptSecret, decryptSecret } from '../../shared/crypto'
import { createSessionToken, verifyPassword, verifySessionToken } from '../../shared/session'
import {
  billedUnits,
  computeAccountProjection,
  computePeriod,
  periodStartFromEnd,
  resolvePeriodUsed,
} from '../../shared/projection'
import { decryptTokenSecrets, fetchTokenUsage, persistUsage } from '../../shared/usage'
import {
  type TokenRow,
  deleteTokenRow,
  getAccountState,
  getDailyUsage,
  getTokenRow,
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
  // Best-effort initial sync so the new token shows data without waiting for cron.
  await refreshTokenUsage(row, c.env)
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
  await c.env.DB.prepare('DELETE FROM account_state WHERE token_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM daily_usage WHERE token_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM snapshots WHERE token_id = ?').bind(id).run()
  await deleteTokenRow(c.env.DB, id)
  return c.json({ ok: true })
})

// Persist a user-defined display order: body.ids is the full token id list in
// the desired order; sort_order becomes the array index.
app.post('/api/tokens/reorder', async (c) => {
  const body = await readJson<{ ids?: unknown }>(c)
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((x): x is string => typeof x === 'string')
    : []
  const rows = await listTokenRows(c.env.DB)
  const known = new Set(rows.map((r) => r.id))
  const unique = new Set(ids)
  if (ids.length !== known.size || unique.size !== ids.length || !ids.every((id) => known.has(id))) {
    return c.json({ error: 'ids must contain every token id exactly once' }, 400)
  }
  const now = Date.now()
  const stmt = c.env.DB.prepare('UPDATE tokens SET sort_order = ?, updated_at = ? WHERE id = ?')
  await c.env.DB.batch(ids.map((id, i) => stmt.bind(i, now, id)))
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
    return c.json({ ok: true, used: usage.used, limit: usage.limit, weekUnits: usage.weekUnits })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message })
  }
})

// Refresh a single token: pull fresh usage from browserless into D1. Each token
// has its own dashboard button so refreshes never fan out across every token at
// once (which would burst browserless's per-IP rate limit from Cloudflare).
app.post('/api/refresh/:id', async (c) => {
  const id = c.req.param('id')
  const row = await getTokenRow(c.env.DB, id)
  if (!row) return c.json({ error: 'not found' }, 404)
  const result = await refreshTokenUsage(row, c.env)
  if (!result.ok) return c.json({ error: result.error || 'refresh failed' }, 502)
  return c.json({ ok: true })
})

// --- Usage overview (reads cached data from D1; no external calls) ---
app.get('/api/usage', async (c) => {
  const rows = await listTokenRows(c.env.DB)
  const now = Date.now()
  const tokens = await Promise.all(rows.map((row) => readTokenUsage(row, c.env, now)))

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

// Read cached usage from D1 and compute the projection. No external calls.
async function readTokenUsage(row: TokenRow, env: Env, now: number): Promise<TokenUsage> {
  const token = await toPublic(row, env)
  try {
    const state = await getAccountState(env.DB, row.id)
    const fallback = computePeriod(row.reset_day, now)
    const periodEnd = state?.period_end ?? fallback.end
    const periodStart = state?.period_end ? periodStartFromEnd(state.period_end) : fallback.start
    const since = Math.min(periodStart, now - 8 * DAY_MS)
    const daily = await getDailyUsage(env.DB, row.id, since)

    const limit = state?.available ?? row.plan_limit
    // The browserless API's used figure only covers its trailing ~week window, so it
    // shrinks as old days roll off. Accumulate the per-day buckets banked in D1 over
    // the whole period instead (the API's latest week is already merged into them).
    const used = resolvePeriodUsed({
      source: row.source as TokenSource,
      stateUsed: state?.used ?? null,
      daily,
      periodStart,
      now,
    })

    const projection = computeAccountProjection({ used, limit, periodStart, periodEnd, daily, now })
    const weekUnits = daily
      .filter((d) => d.dayStart >= now - 7 * DAY_MS)
      .reduce((s, d) => s + billedUnits(d), 0)
    const usageResult: UsageResult = {
      usedThisPeriod: used,
      weekUnits,
      periodStart,
      fetchedAt: state?.updated_at ?? 0, // 0 => never synced yet
    }
    const sparkline = daily
      .filter((d) => d.dayStart >= periodStart)
      .map((d) => ({ capturedAt: d.dayStart, totalUnits: billedUnits(d) }))
    return { token, usage: usageResult, projection, sparkline, status: 'ok' }
  } catch (err) {
    return { token, usage: null, projection: null, sparkline: [], status: 'error', error: (err as Error).message }
  }
}

// Pull fresh usage from browserless into D1. Errors are returned, not thrown.
async function refreshTokenUsage(
  row: TokenRow,
  env: Env,
): Promise<{ id: string; ok: boolean; error?: string }> {
  try {
    const secrets = await decryptTokenSecrets(row, env.ENCRYPTION_KEY)
    const usage = await fetchTokenUsage(rowToRecord(row), secrets)
    await persistUsage(env.DB, row.id, usage)
    return { id: row.id, ok: true }
  } catch (err) {
    return { id: row.id, ok: false, error: (err as Error).message }
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
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
    return { error: 'resetDay must be an integer 1..31' }
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
