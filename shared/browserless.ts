// Browserless.io usage client.
//
// Verified against the live API (2026-06): the dashboard reads usage via
//   accountUsage(apiToken, timeframe) { aggregatedData { date units ... } summary { units } }
// at https://api.browserless.io/graphql, and it works with the API TOKEN ALONE
// (no account login / Bearer needed). `timeframe` only accepts hour | day | week,
// so for the monthly billing total we accumulate the per-day buckets ourselves.
import type { DailyBucket } from './types'

const GRAPHQL_ENDPOINT = 'https://api.browserless.io/graphql'
const DAY_MS = 24 * 60 * 60 * 1000

export interface AccountUsage {
  /** Per-day buckets (UTC day start), most recent ~8 days. */
  daily: DailyBucket[]
  /** Total units over the trailing week (from the API summary). */
  weekUnits: number
  fetchedAt: number
}

const ACCOUNT_USAGE_QUERY = `query AccountUsage($apiToken: String!, $timeframe: timeframe!) {
  accountUsage(apiToken: $apiToken, timeframe: $timeframe) {
    aggregatedData { date units successful proxy captcha seconds }
    summary { units }
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

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function gql<T>(query: string, variables: object): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`browserless graphql HTTP ${res.status}`)
  const json = (await res.json()) as GraphQLResponse<T>
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  if (!json.data) throw new Error('browserless graphql returned no data')
  return json.data
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

export async function fetchCloudUsage(apiToken: string): Promise<AccountUsage> {
  const data = await gql<{
    accountUsage: { aggregatedData: AggRow[] | null; summary: { units: number } | null }
  }>(ACCOUNT_USAGE_QUERY, { apiToken, timeframe: 'week' })
  const au = data.accountUsage
  return {
    daily: (au.aggregatedData ?? []).map(toBucket),
    weekUnits: au.summary?.units ?? 0,
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
  // Self-hosted /metrics/total is an aggregate, not a daily series; record it as today's bucket.
  return {
    daily: [{ dayStart: today, units, successful: 0, proxy: 0, captcha: 0, seconds: 0 }],
    weekUnits: units,
    fetchedAt: Date.now(),
  }
}
