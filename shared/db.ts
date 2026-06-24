// D1 access layer. Only imported by the Worker/Functions runtime (uses D1Database
// from @cloudflare/workers-types), never by the frontend.
import type { SnapshotPoint, TokenRecord, TokenSource } from './types'

export interface TokenRow {
  id: string
  label: string
  source: string
  endpoint_url: string | null
  api_token_enc: string
  account_enc: string | null
  plan_limit: number
  reset_day: number
  sort_order: number
  created_at: number
  updated_at: number
}

export function rowToRecord(r: TokenRow): TokenRecord {
  return {
    id: r.id,
    label: r.label,
    source: r.source as TokenSource,
    endpointUrl: r.endpoint_url,
    planLimit: r.plan_limit,
    resetDay: r.reset_day,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasAccountLogin: r.account_enc != null,
  }
}

export async function listTokenRows(db: D1Database): Promise<TokenRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM tokens ORDER BY sort_order, created_at')
    .all<TokenRow>()
  return results ?? []
}

export async function getTokenRow(db: D1Database, id: string): Promise<TokenRow | null> {
  return db.prepare('SELECT * FROM tokens WHERE id = ?').bind(id).first<TokenRow>()
}

export async function insertTokenRow(db: D1Database, row: TokenRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tokens
        (id, label, source, endpoint_url, api_token_enc, account_enc, plan_limit, reset_day, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.label,
      row.source,
      row.endpoint_url,
      row.api_token_enc,
      row.account_enc,
      row.plan_limit,
      row.reset_day,
      row.sort_order,
      row.created_at,
      row.updated_at,
    )
    .run()
}

/** Update only the provided columns. Keys are code-controlled (no injection risk). */
export async function updateTokenRow(
  db: D1Database,
  id: string,
  set: Partial<Omit<TokenRow, 'id'>>,
): Promise<void> {
  const keys = Object.keys(set)
  if (keys.length === 0) return
  const assignments = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (set as Record<string, unknown>)[k])
  await db
    .prepare(`UPDATE tokens SET ${assignments} WHERE id = ?`)
    .bind(...values, id)
    .run()
}

export async function deleteTokenRow(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM tokens WHERE id = ?').bind(id).run()
}

export interface SnapshotInput {
  tokenId: string
  capturedAt: number
  periodStart: number
  totalUnits: number
  timeUnits: number | null
  proxyUnits: number | null
  captchaUnits: number | null
  rawJson?: string | null
}

export async function insertSnapshot(db: D1Database, s: SnapshotInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots
        (token_id, captured_at, period_start, total_units, time_units, proxy_units, captcha_units, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      s.tokenId,
      s.capturedAt,
      s.periodStart,
      s.totalUnits,
      s.timeUnits,
      s.proxyUnits,
      s.captchaUnits,
      s.rawJson ?? null,
    )
    .run()
}

export async function getRecentSnapshots(
  db: D1Database,
  tokenId: string,
  sinceMs: number,
): Promise<SnapshotPoint[]> {
  const { results } = await db
    .prepare(
      'SELECT captured_at, total_units FROM snapshots WHERE token_id = ? AND captured_at >= ? ORDER BY captured_at',
    )
    .bind(tokenId, sinceMs)
    .all<{ captured_at: number; total_units: number }>()
  return (results ?? []).map((r) => ({ capturedAt: r.captured_at, totalUnits: r.total_units }))
}
