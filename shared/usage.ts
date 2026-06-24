// Ties decryption + the browserless client + period math together so both the
// Pages Functions API and the cron Worker fetch usage identically.
import type { TokenRecord, UsageResult } from './types'
import { decryptSecret } from './crypto'
import { computePeriod } from './projection'
import {
  fetchCloudUsage,
  fetchSelfHostedUsage,
  NeedsLoginError,
  type AccountLogin,
  type RawUsage,
} from './browserless'

export { NeedsLoginError }

export interface TokenSecrets {
  apiToken: string
  account?: AccountLogin
}

export interface EncryptedTokenFields {
  api_token_enc: string
  account_enc: string | null
}

/** Decrypt a token row's secrets using the AES key. */
export async function decryptTokenSecrets(
  row: EncryptedTokenFields,
  encryptionKey: string,
): Promise<TokenSecrets> {
  const apiToken = await decryptSecret(row.api_token_enc, encryptionKey)
  let account: AccountLogin | undefined
  if (row.account_enc) {
    try {
      account = JSON.parse(await decryptSecret(row.account_enc, encryptionKey)) as AccountLogin
    } catch {
      account = undefined
    }
  }
  return { apiToken, account }
}

/** Fetch + normalize usage for a single token (throws NeedsLoginError when applicable). */
export async function fetchUsageForToken(
  token: TokenRecord,
  secrets: TokenSecrets,
  now = Date.now(),
): Promise<UsageResult> {
  let raw: RawUsage
  if (token.source === 'self-hosted') {
    if (!token.endpointUrl) throw new Error('Self-hosted token is missing its endpoint URL.')
    raw = await fetchSelfHostedUsage(token.endpointUrl, secrets.apiToken)
  } else {
    raw = await fetchCloudUsage(secrets.apiToken, secrets.account)
  }
  const { start } = computePeriod(token.resetDay, now)
  return { ...raw, periodStart: start }
}
