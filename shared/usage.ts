// Ties decryption + the browserless client together so both the Pages Functions
// API and the cron Worker fetch usage identically.
import type { TokenRecord } from './types'
import { decryptSecret } from './crypto'
import { type AccountUsage, fetchCloudUsage, fetchSelfHostedUsage } from './browserless'
import { upsertAccountState, upsertDailyUsage } from './db'

export interface TokenSecrets {
  apiToken: string
  /** Optional browserless session Bearer, enabling the exact account.cloudUnits totals. */
  authToken?: string
}

/** Persist a fetched usage result (account snapshot + daily buckets) into D1. */
export async function persistUsage(
  db: D1Database,
  tokenId: string,
  usage: AccountUsage,
): Promise<void> {
  await upsertAccountState(
    db,
    tokenId,
    { used: usage.used, available: usage.limit, planName: usage.planName, periodEnd: usage.periodEnd },
    usage.fetchedAt,
  )
  for (const b of usage.daily) {
    await upsertDailyUsage(db, tokenId, b, usage.fetchedAt)
  }
}

/** Decrypt a token row's API token (and optional session Bearer in account_enc). */
export async function decryptTokenSecrets(
  row: { api_token_enc: string; account_enc?: string | null },
  encryptionKey: string,
): Promise<TokenSecrets> {
  const apiToken = await decryptSecret(row.api_token_enc, encryptionKey)
  let authToken: string | undefined
  if (row.account_enc) {
    try {
      authToken = await decryptSecret(row.account_enc, encryptionKey)
    } catch {
      authToken = undefined
    }
  }
  return { apiToken, authToken }
}

/** Fetch recent per-day usage for a single token. */
export async function fetchTokenUsage(
  token: TokenRecord,
  secrets: TokenSecrets,
): Promise<AccountUsage> {
  if (token.source === 'self-hosted') {
    if (!token.endpointUrl) throw new Error('Self-hosted token is missing its endpoint URL.')
    return fetchSelfHostedUsage(token.endpointUrl, secrets.apiToken)
  }
  return fetchCloudUsage(secrets.apiToken, secrets.authToken)
}
