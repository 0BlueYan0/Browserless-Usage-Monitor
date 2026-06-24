// Browserless.io usage client.
//
// Verified against the live API (2026-06), all token-only (no account login):
//   - account(apiToken) { cloudUnits { used available name } stripe { current_period_end } }
//       → authoritative billing-period units used, the plan limit, and the reset date.
//   - accountUsage(apiToken, timeframe: week) { aggregatedData { date units ... } }
//       → recent per-day buckets, used for the burn-rate sparkline.
// Both are fetched in one request. `timeframe` only accepts hour | day | week.
import type { DailyBucket } from './types'

const GRAPHQL_ENDPOINT = 'https://api.browserless.io/graphql'
const DAY_MS = 24 * 60 * 60 * 1000

export interface AccountUsage {
  /** Authoritative units used this billing period (cloudUnits.used). Null if unavailable. */
  used: number | null
  /** Plan limit (cloudUnits.available). Null if unavailable. */
  limit: number | null
  /** Plan name, e.g. "free". */
  planName: string | null
  /** Billing period end (epoch ms, from Stripe current_period_end). Null if unavailable. */
  periodEnd: number | null
  /** Recent per-day buckets (UTC day start) for the burn-rate sparkline. */
  daily: DailyBucket[]
  /** Total units over the trailing week (sum of daily). */
  weekUnits: number
  fetchedAt: number
}

// accountUsage works with the API token alone. account.cloudUnits (exact period
// total + limit) needs the session Bearer, so it's only fetched when authToken is set.
const ACCOUNT_USAGE_QUERY = `query AccountUsage($apiToken: String!, $timeframe: timeframe!) {
  accountUsage(apiToken: $apiToken, timeframe: $timeframe) {
    aggregatedData { date units successful proxy captcha seconds }
  }
}`

const ACCOUNT_QUERY = `query Account($apiToken: String!) {
  account(apiToken: $apiToken) {
    cloudUnits { used available name }
    stripe { current_period_end }
  }
}`

interface AggRow {
  date: number
  units: number
  successful: number
  proxy: number
  captcha: number
  seconds: number
}

interface AccountData {
  account: {
    cloudUnits: { used: number | null; available: number | null; name: string | null } | null
    stripe: { current_period_end: number | null } | null
  } | null
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isTransient = (msg: string) => /maximum request attempts|rate|timeout|temporarily/i.test(msg)

// Retries a few times with backoff. browserless rate-limits by source IP, and
// Cloudflare's shared egress IPs can trip "Maximum request attempts exceeded".
async function gql<T>(query: string, variables: object, authToken?: string): Promise<T> {
  let lastError = new Error('browserless graphql failed')
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 1200)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (authToken) headers.authorization = `Bearer ${authToken}`
      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      })
      if (!res.ok) {
        lastError = new Error(`browserless graphql HTTP ${res.status}`)
        if (res.status >= 500 || res.status === 429) continue
        throw lastError
      }
      const json = (await res.json()) as GraphQLResponse<T>
      if (json.errors && json.errors.length > 0) {
        lastError = new Error(json.errors.map((e) => e.message).join('; '))
        if (isTransient(lastError.message)) continue
        throw lastError
      }
      if (!json.data) {
        lastError = new Error('browserless graphql returned no data')
        continue
      }
      return json.data
    } catch (err) {
      lastError = err as Error
      if (!isTransient(lastError.message)) throw lastError
    }
  }
  throw lastError
}

function toBucket(r: AggRow): DailyBucket {
  return {
    // The API timestamps each daily bucket at the day's *end* (next UTC midnight),
    // e.g. the 24th's usage is dated the 25th. Shift back so dayStart is the day itself.
    dayStart: Math.floor(r.date / DAY_MS) * DAY_MS - DAY_MS,
    units: r.units ?? 0,
    successful: r.successful ?? 0,
    proxy: r.proxy ?? 0,
    captcha: r.captcha ?? 0,
    seconds: r.seconds ?? 0,
  }
}

export async function fetchCloudUsage(apiToken: string, authToken?: string): Promise<AccountUsage> {
  // Daily buckets — token-only, always available.
  const usageData = await gql<{ accountUsage: { aggregatedData: AggRow[] | null } | null }>(
    ACCOUNT_USAGE_QUERY,
    { apiToken, timeframe: 'week' },
  )
  const daily = (usageData.accountUsage?.aggregatedData ?? []).map(toBucket)

  // Exact period total + limit + reset date — only when a session Bearer is provided.
  let used: number | null = null
  let limit: number | null = null
  let planName: string | null = null
  let periodEnd: number | null = null
  if (authToken) {
    try {
      const acc = await gql<AccountData>(ACCOUNT_QUERY, { apiToken }, authToken)
      const cu = acc.account?.cloudUnits
      used = cu?.used ?? null
      limit = cu?.available ?? null
      planName = cu?.name ?? null
      const pe = acc.account?.stripe?.current_period_end ?? null
      periodEnd = pe != null ? pe * 1000 : null
    } catch {
      // authToken expired/invalid — fall back to daily-bucket accumulation.
    }
  }

  return {
    used,
    limit,
    planName,
    periodEnd,
    daily,
    weekUnits: daily.reduce((s, b) => s + b.units, 0),
    fetchedAt: Date.now(),
  }
}

export async function fetchSelfHostedUsage(endpoint: string, token: string): Promise<AccountUsage> {
  const base = endpoint.replace(/\/+$/, '')
  const res = await fetch(`${base}/metrics/total?token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`metrics/total HTTP ${res.status}`)
  const json = (await res.json()) as { units?: unknown }
  const units = typeof json.units === 'number' ? json.units : 0
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS
  // Self-hosted /metrics/total is an aggregate; the plan limit / period come from the
  // token's manual settings (no account query for self-hosted fleets).
  return {
    used: units,
    limit: null,
    planName: null,
    periodEnd: null,
    daily: [{ dayStart: today, units, successful: 0, proxy: 0, captcha: 0, seconds: 0 }],
    weekUnits: units,
    fetchedAt: Date.now(),
  }
}
