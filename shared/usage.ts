// Ties decryption + the browserless client together so both the Pages Functions
// API and the cron Worker fetch usage identically.
import type { TokenRecord } from './types'
import { decryptSecret } from './crypto'
import { type AccountUsage, fetchCloudUsage, fetchSelfHostedUsage } from './browserless'

export interface TokenSecrets {
  apiToken: string
}

/** Decrypt a token row's API token. */
export async function decryptTokenSecrets(
  row: { api_token_enc: string },
  encryptionKey: string,
): Promise<TokenSecrets> {
  return { apiToken: await decryptSecret(row.api_token_enc, encryptionKey) }
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
  return fetchCloudUsage(secrets.apiToken)
}
