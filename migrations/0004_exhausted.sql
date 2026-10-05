-- Last time a browserless endpoint rejected the token with "units usage limit".
-- accountUsage can report 0 units for an exhausted token, so this is the only
-- token-only signal that the quota is gone. NULL = not exhausted / never seen.
ALTER TABLE account_state ADD COLUMN exhausted_at INTEGER;
