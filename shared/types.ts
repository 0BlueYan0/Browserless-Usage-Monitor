// Shared, environment-agnostic types. Imported by both the Worker/Functions
// runtime and the React frontend, so this file must NOT reference any
// Cloudflare/DOM/Node-only globals.

export type TokenSource = 'cloud' | 'self-hosted'

/** Server-side token record (decrypted secrets are never part of this shape). */
export interface TokenRecord {
  id: string
  label: string
  source: TokenSource
  endpointUrl: string | null
  planLimit: number
  resetDay: number
  sortOrder: number
  createdAt: number
  updatedAt: number
  hasAccountLogin: boolean
}

/** Client-facing token: no secrets, API token shown only as a mask. */
export interface TokenPublic extends TokenRecord {
  tokenMask: string
}

/** One day's usage, as returned by accountUsage(timeframe: week). */
export interface DailyBucket {
  dayStart: number
  units: number
  successful: number
  proxy: number
  captcha: number
  seconds: number
}

/** Normalized usage summary for one token within the current billing period. */
export interface UsageResult {
  usedThisPeriod: number
  weekUnits: number
  periodStart: number
  fetchedAt: number
}

export type ProjectionMethod = 'linear' | 'burn-rate' | 'none'

export interface Projection {
  planLimit: number
  used: number
  remaining: number
  percentUsed: number
  periodStart: number
  periodEnd: number
  daysInPeriod: number
  daysElapsed: number
  dailyRate: number
  projectedPeriodTotal: number
  willExceed: boolean
  /** null = not projected to run out before the period resets. */
  daysUntilExhausted: number | null
  exhaustionDate: number | null
  method: ProjectionMethod
}

export interface SnapshotPoint {
  capturedAt: number
  totalUnits: number
}

export type TokenStatus = 'ok' | 'needs-login' | 'error'

/** Per-token result returned by /api/usage. */
export interface TokenUsage {
  token: TokenPublic
  usage: UsageResult | null
  projection: Projection | null
  sparkline: SnapshotPoint[]
  status: TokenStatus
  error?: string
}

export interface UsageAggregate {
  totalUsed: number
  totalLimit: number
  percentUsed: number
  soonestExhaustionTokenId: string | null
  soonestDaysRemaining: number | null
}

export interface UsageResponse {
  tokens: TokenUsage[]
  aggregate: UsageAggregate
}

/** Payload accepted by POST /api/tokens and PUT /api/tokens/:id. */
export interface TokenInput {
  label: string
  source: TokenSource
  endpointUrl?: string | null
  apiToken?: string
  account?: { email: string; password: string } | null
  planLimit: number
  resetDay: number
}
