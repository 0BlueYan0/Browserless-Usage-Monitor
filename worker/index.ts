// Scheduled Worker: periodically records each token's per-day usage buckets into
// the shared D1 database so the monthly total survives the API's 7-day window and
// the dashboard can compute a real burn rate.
import { decryptTokenSecrets, fetchTokenUsage, persistUsage } from '../shared/usage'
import { listTokenRows, rowToRecord } from '../shared/db'

interface Env {
  DB: D1Database
  ENCRYPTION_KEY: string
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyUsage(env))
  },

  // Also reachable over HTTP so it can be poked locally (`/run`) during dev.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/run') {
      const result = await runDailyUsage(env)
      return Response.json({ ok: true, ...result })
    }
    return new Response('browserless-usage-monitor cron worker', { status: 200 })
  },
} satisfies ExportedHandler<Env>

async function runDailyUsage(env: Env): Promise<{ tokens: number; buckets: number }> {
  const now = Date.now()
  const rows = await listTokenRows(env.DB)
  let tokens = 0
  let buckets = 0
  for (const row of rows) {
    try {
      const secrets = await decryptTokenSecrets(row, env.ENCRYPTION_KEY)
      const usage = await fetchTokenUsage(rowToRecord(row), secrets)
      await persistUsage(env.DB, row.id, usage)
      buckets += usage.daily.length
      tokens++
    } catch (err) {
      console.error(`usage fetch failed for token ${row.id}:`, (err as Error).message)
    }
  }
  return { tokens, buckets }
}
