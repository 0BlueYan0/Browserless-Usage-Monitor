import type { Projection, TokenStatus } from '../../shared/types'

export interface PlanTier {
  label: string
  units: number | null
}

// Browserless cloud tiers (monthly unit allowances). "Custom" lets the user type a value.
export const PLAN_TIERS: PlanTier[] = [
  { label: 'Free', units: 1000 },
  { label: 'Starter', units: 5000 },
  { label: 'Scale', units: 25000 },
  { label: 'Custom', units: null },
]

export type Health = 'ok' | 'warn' | 'crit'

/** Health from percent used (low usage is healthy). */
export function healthFromPercent(pct: number): Health {
  if (pct >= 90) return 'crit'
  if (pct >= 75) return 'warn'
  return 'ok'
}

/** Combine percent-used with projection to decide a token's health colour. */
export function healthFromProjection(p: Projection): Health {
  if (p.remaining <= 0) return 'crit'
  const byPct = healthFromPercent(p.percentUsed)
  if (p.willExceed && byPct === 'ok') return 'warn'
  return byPct
}

export const HEALTH_TEXT: Record<Health, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
}

export const HEALTH_BG: Record<Health, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
}

export const STATUS_LABEL: Record<TokenStatus, string> = {
  ok: 'Live',
  'needs-login': 'Needs login',
  error: 'Error',
}
