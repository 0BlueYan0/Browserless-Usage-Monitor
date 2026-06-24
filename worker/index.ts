// Scheduled Worker: periodically records a usage snapshot per token into the
// shared D1 database so the dashboard can compute a real burn rate.
import { computePeriod } from '../shared/projection'
import { decryptTokenSecrets, fetchUsageForToken } from '../shared/usage'
import { insertSnapshot, listTokenRows, rowToRecord } from '../shared/db'

interface Env {
  DB: D1Database
  ENCRYPTION_KEY: string
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSnapshots(env))
  },

  // Also reachable over HTTP so it can be poked locally (`/run`) during dev.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/run') {
      const count = await runSnapshots(env)
      return Response.json({ ok: true, snapshots: count })
    }
    return new Response('browserless-usage-monitor cron worker', { status: 200 })
  },
} satisfies ExportedHandler<Env>

async function runSnapshots(env: Env): Promise<number> {
  const now = Date.now()
  const rows = await listTokenRows(env.DB)
  let written = 0
  for (const row of rows) {
    try {
      const secrets = await decryptTokenSecrets(row, env.ENCRYPTION_KEY)
      const usage = await fetchUsageForToken(rowToRecord(row), secrets, now)
      const { start } = computePeriod(row.reset_day, now)
      await insertSnapshot(env.DB, {
        tokenId: row.id,
        capturedAt: usage.fetchedAt,
        periodStart: start,
        totalUnits: usage.totalUnitsUsed,
        timeUnits: usage.timeUnits,
        proxyUnits: usage.proxyUnits,
        captchaUnits: usage.captchaUnits,
        rawJson: null,
      })
      written++
    } catch (err) {
      // A failing token (e.g. needs-login) shouldn't stop the others; the
      // dashboard surfaces its status separately.
      console.error(`snapshot failed for token ${row.id}:`, (err as Error).message)
    }
  }
  return written
}
