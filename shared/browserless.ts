// Browserless.io usage clients. Two paths:
//   - cloud: GraphQL exportMetrics at api.browserless.io/graphql
//   - self-hosted: GET {endpoint}/metrics/total
//
// NOTE: the exact GraphQL shape (arg/type names) and whether the API token alone
// is accepted (vs. needing an account login authToken) is uncertain from the
// public docs. This module is the single place to adjust once verified against a
// real token (see milestone "資料來源驗證" in the plan). The token-only path is
// attempted first; on failure we fall back to the account-login flow if creds
// were provided, otherwise we surface NeedsLoginError.

const GRAPHQL_ENDPOINT = 'https://api.browserless.io/graphql'

export interface AccountLogin {
  email: string
  password: string
}

export interface RawUsage {
  totalUnitsUsed: number
  timeUnits: number | null
  proxyUnits: number | null
  captchaUnits: number | null
  fetchedAt: number
}

export class NeedsLoginError extends Error {
  constructor(message = 'This token needs an account login to read usage.') {
    super(message)
    this.name = 'NeedsLoginError'
  }
}

interface ExportMetricsRow {
  date: string
  totalUnitsUsed: number
  timeUnits: number
  proxyUnits: number
  captchaUnits: number
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

const EXPORT_METRICS_QUERY = `
query ExportMetrics($apiToken: String!, $authToken: String, $timeslot: timeslot) {
  exportMetrics(apiToken: $apiToken, authToken: $authToken, timeslot: $timeslot) {
    date
    totalUnitsUsed
    timeUnits
    proxyUnits
    captchaUnits
  }
}`

const LOGIN_MUTATION = `
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    authToken
    needsSecondFactor
  }
}`

async function gqlRequest<T>(query: string, variables: object): Promise<T> {
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

async function login(account: AccountLogin): Promise<string> {
  const data = await gqlRequest<{ login: { authToken: string; needsSecondFactor: boolean } }>(
    LOGIN_MUTATION,
    account,
  )
  if (data.login.needsSecondFactor) {
    // 2FA accounts can't be used with stored email/password alone.
    throw new NeedsLoginError('This account has 2FA enabled, which is not supported for stored login.')
  }
  return data.login.authToken
}

function pickCurrentRow(rows: ExportMetricsRow[], now: number): ExportMetricsRow | null {
  if (!rows.length) return null
  const d = new Date(now)
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const match = rows.find((r) => typeof r.date === 'string' && r.date.startsWith(ym))
  return match ?? rows[rows.length - 1]
}

function rowToUsage(row: ExportMetricsRow | null, fetchedAt: number): RawUsage {
  return {
    totalUnitsUsed: row?.totalUnitsUsed ?? 0,
    timeUnits: row?.timeUnits ?? null,
    proxyUnits: row?.proxyUnits ?? null,
    captchaUnits: row?.captchaUnits ?? null,
    fetchedAt,
  }
}

async function queryExportMetrics(apiToken: string, authToken: string | undefined): Promise<ExportMetricsRow[]> {
  const data = await gqlRequest<{ exportMetrics: ExportMetricsRow[] }>(EXPORT_METRICS_QUERY, {
    apiToken,
    authToken,
    timeslot: 'month',
  })
  return data.exportMetrics ?? []
}

export async function fetchCloudUsage(apiToken: string, account?: AccountLogin): Promise<RawUsage> {
  const now = Date.now()
  try {
    const rows = await queryExportMetrics(apiToken, undefined)
    return rowToUsage(pickCurrentRow(rows, now), now)
  } catch (tokenOnlyError) {
    if (!account) {
      throw new NeedsLoginError(
        `Token-only usage query failed (${(tokenOnlyError as Error).message}). Add account login for this token.`,
      )
    }
    const authToken = await login(account)
    const rows = await queryExportMetrics(apiToken, authToken)
    return rowToUsage(pickCurrentRow(rows, now), now)
  }
}

export async function fetchSelfHostedUsage(endpoint: string, token: string): Promise<RawUsage> {
  const base = endpoint.replace(/\/+$/, '')
  const url = `${base}/metrics/total?token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`metrics/total HTTP ${res.status}`)
  const json = (await res.json()) as unknown
  const units = extractUnits(json)
  return {
    totalUnitsUsed: units,
    timeUnits: null,
    proxyUnits: null,
    captchaUnits: null,
    fetchedAt: Date.now(),
  }
}

function extractUnits(json: unknown): number {
  if (json && typeof json === 'object' && 'units' in json) {
    const u = (json as { units: unknown }).units
    if (typeof u === 'number') return u
  }
  if (Array.isArray(json)) {
    return json.reduce((sum: number, r) => sum + (typeof r?.units === 'number' ? r.units : 0), 0)
  }
  return 0
}
