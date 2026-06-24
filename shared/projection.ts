// Pure billing-period + days-remaining math. No I/O, fully unit-testable.
import type { Projection, ProjectionMethod, SnapshotPoint } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Clamp a reset day-of-month into a safe 1..28 range (avoids short-month gaps). */
export function normalizeResetDay(resetDay: number): number {
  if (!Number.isFinite(resetDay)) return 1
  return Math.min(Math.max(Math.trunc(resetDay), 1), 28)
}

/**
 * Current billing period [start, end) in epoch ms (UTC), based on a reset
 * day-of-month. `start` is the most recent occurrence of the reset day at or
 * before `now`; `end` is the next occurrence.
 */
export function computePeriod(resetDay: number, now: number): { start: number; end: number } {
  const day = normalizeResetDay(resetDay)
  const d = new Date(now)
  let year = d.getUTCFullYear()
  let month = d.getUTCMonth()
  if (d.getUTCDate() < day) {
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
  }
  const start = Date.UTC(year, month, day)
  let endYear = year
  let endMonth = month + 1
  if (endMonth > 11) {
    endMonth = 0
    endYear += 1
  }
  const end = Date.UTC(endYear, endMonth, day)
  return { start, end }
}

/**
 * Recent daily burn rate (units/day) from snapshots within the current period.
 * Uses a trailing 7-day window when possible. Returns null when there isn't a
 * usable span (<2 points or <0.5 days apart) or the counter went backwards.
 */
export function burnRateFromSnapshots(
  snapshots: SnapshotPoint[] | undefined,
  periodStart: number,
  now: number,
): number | null {
  if (!snapshots || snapshots.length < 2) return null
  const pts = snapshots
    .filter((s) => s.capturedAt >= periodStart && s.capturedAt <= now)
    .sort((a, b) => a.capturedAt - b.capturedAt)
  if (pts.length < 2) return null

  const windowStart = now - 7 * DAY_MS
  const windowed = pts.filter((s) => s.capturedAt >= windowStart)
  const series = windowed.length >= 2 ? windowed : pts

  const first = series[0]
  const last = series[series.length - 1]
  const spanDays = (last.capturedAt - first.capturedAt) / DAY_MS
  if (spanDays < 0.5) return null
  const delta = last.totalUnits - first.totalUnits
  if (delta < 0) return null
  return delta / spanDays
}

export interface ProjectionInput {
  planLimit: number
  used: number
  resetDay: number
  now: number
  /** Optional snapshots for burn-rate calculation. */
  snapshots?: SnapshotPoint[]
}

/** Compute usage projection and estimated days remaining for one token. */
export function computeProjection(input: ProjectionInput): Projection {
  const { planLimit, used, resetDay, now } = input
  const { start: periodStart, end: periodEnd } = computePeriod(resetDay, now)
  const daysInPeriod = (periodEnd - periodStart) / DAY_MS
  const daysElapsed = Math.max((now - periodStart) / DAY_MS, 0)
  const remaining = Math.max(planLimit - used, 0)
  const percentUsed = planLimit > 0 ? (used / planLimit) * 100 : 0

  let dailyRate = 0
  let method: ProjectionMethod = 'none'

  const burn = burnRateFromSnapshots(input.snapshots, periodStart, now)
  if (burn !== null) {
    dailyRate = burn
    method = 'burn-rate'
  } else if (used > 0) {
    dailyRate = used / Math.max(daysElapsed, 0.5)
    method = 'linear'
  }

  const daysToPeriodEnd = Math.max((periodEnd - now) / DAY_MS, 0)
  const projectedPeriodTotal = method === 'none' ? used : used + dailyRate * daysToPeriodEnd
  const willExceed = projectedPeriodTotal > planLimit

  let daysUntilExhausted: number | null = null
  let exhaustionDate: number | null = null
  if (remaining <= 0) {
    daysUntilExhausted = 0
    exhaustionDate = now
  } else if (dailyRate > 0) {
    const days = remaining / dailyRate
    const exhaustAt = now + days * DAY_MS
    if (exhaustAt < periodEnd) {
      daysUntilExhausted = days
      exhaustionDate = exhaustAt
    }
  }

  return {
    planLimit,
    used,
    remaining,
    percentUsed,
    periodStart,
    periodEnd,
    daysInPeriod,
    daysElapsed,
    dailyRate,
    projectedPeriodTotal,
    willExceed,
    daysUntilExhausted,
    exhaustionDate,
    method,
  }
}

export interface DailyPoint {
  dayStart: number
  units: number
}

/** Derive a period start by stepping one month back from a known period end. */
export function periodStartFromEnd(periodEnd: number): number {
  const d = new Date(periodEnd)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  )
}

export interface AccountProjectionInput {
  /** Authoritative units used this period (from account.cloudUnits.used). */
  used: number
  /** Plan limit. */
  limit: number
  periodStart: number
  periodEnd: number
  /** Recent per-day buckets for the burn rate. */
  daily: DailyPoint[]
  now: number
}

/**
 * Projection using the authoritative period total + limit + period end from
 * account.cloudUnits, with the burn rate derived from recent daily buckets.
 */
export function computeAccountProjection(input: AccountProjectionInput): Projection {
  const { used, limit, periodStart, periodEnd, daily, now } = input
  const daysInPeriod = (periodEnd - periodStart) / DAY_MS
  const daysElapsed = Math.max((now - periodStart) / DAY_MS, 0)
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS
  const remaining = Math.max(limit - used, 0)
  const percentUsed = limit > 0 ? (used / limit) * 100 : 0

  const windowStart = todayStart - 7 * DAY_MS
  const completeDays = daily.filter((d) => d.dayStart >= windowStart && d.dayStart < todayStart)

  let dailyRate = 0
  let method: ProjectionMethod = 'none'
  if (completeDays.length > 0) {
    dailyRate = completeDays.reduce((sum, d) => sum + d.units, 0) / completeDays.length
    method = 'burn-rate'
  } else if (used > 0 && daysElapsed > 0) {
    dailyRate = used / Math.max(daysElapsed, 0.5)
    method = 'linear'
  }

  const daysToPeriodEnd = Math.max((periodEnd - now) / DAY_MS, 0)
  const projectedPeriodTotal = method === 'none' ? used : used + dailyRate * daysToPeriodEnd
  const willExceed = projectedPeriodTotal > limit

  let daysUntilExhausted: number | null = null
  let exhaustionDate: number | null = null
  if (remaining <= 0) {
    daysUntilExhausted = 0
    exhaustionDate = now
  } else if (dailyRate > 0) {
    const days = remaining / dailyRate
    const exhaustAt = now + days * DAY_MS
    if (exhaustAt < periodEnd) {
      daysUntilExhausted = days
      exhaustionDate = exhaustAt
    }
  }

  return {
    planLimit: limit,
    used,
    remaining,
    percentUsed,
    periodStart,
    periodEnd,
    daysInPeriod,
    daysElapsed,
    dailyRate,
    projectedPeriodTotal,
    willExceed,
    daysUntilExhausted,
    exhaustionDate,
    method,
  }
}

export interface DailyProjectionInput {
  planLimit: number
  daily: DailyPoint[]
  resetDay: number
  now: number
}

/**
 * Projection from accumulated per-day usage buckets. `used` = sum of buckets in
 * the current billing period; the burn rate is the mean of complete days in the
 * trailing 7-day window (falling back to a linear estimate when there isn't a
 * complete day of data yet).
 */
export function computeProjectionFromDaily(input: DailyProjectionInput): Projection {
  const { planLimit, daily, resetDay, now } = input
  const { start: periodStart, end: periodEnd } = computePeriod(resetDay, now)
  const daysInPeriod = (periodEnd - periodStart) / DAY_MS
  const daysElapsed = Math.max((now - periodStart) / DAY_MS, 0)
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS

  const used = daily
    .filter((d) => d.dayStart >= periodStart && d.dayStart <= now)
    .reduce((sum, d) => sum + d.units, 0)
  const remaining = Math.max(planLimit - used, 0)
  const percentUsed = planLimit > 0 ? (used / planLimit) * 100 : 0

  const windowStart = todayStart - 7 * DAY_MS
  const completeDays = daily.filter((d) => d.dayStart >= windowStart && d.dayStart < todayStart)

  let dailyRate = 0
  let method: ProjectionMethod = 'none'
  if (completeDays.length > 0) {
    dailyRate = completeDays.reduce((sum, d) => sum + d.units, 0) / completeDays.length
    method = 'burn-rate'
  } else if (used > 0) {
    dailyRate = used / Math.max(daysElapsed, 0.5)
    method = 'linear'
  }

  const daysToPeriodEnd = Math.max((periodEnd - now) / DAY_MS, 0)
  const projectedPeriodTotal = method === 'none' ? used : used + dailyRate * daysToPeriodEnd
  const willExceed = projectedPeriodTotal > planLimit

  let daysUntilExhausted: number | null = null
  let exhaustionDate: number | null = null
  if (remaining <= 0) {
    daysUntilExhausted = 0
    exhaustionDate = now
  } else if (dailyRate > 0) {
    const days = remaining / dailyRate
    const exhaustAt = now + days * DAY_MS
    if (exhaustAt < periodEnd) {
      daysUntilExhausted = days
      exhaustionDate = exhaustAt
    }
  }

  return {
    planLimit,
    used,
    remaining,
    percentUsed,
    periodStart,
    periodEnd,
    daysInPeriod,
    daysElapsed,
    dailyRate,
    projectedPeriodTotal,
    willExceed,
    daysUntilExhausted,
    exhaustionDate,
    method,
  }
}
