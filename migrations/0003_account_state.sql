-- Latest authoritative account snapshot per token, from account.cloudUnits.
-- Lets the dashboard read the exact billing-period total, plan limit, and reset
-- date from D1 without calling browserless on every load.

CREATE TABLE IF NOT EXISTS account_state (
  token_id   TEXT PRIMARY KEY REFERENCES tokens(id) ON DELETE CASCADE,
  used       REAL,
  available  REAL,
  plan_name  TEXT,
  period_end INTEGER,
  updated_at INTEGER NOT NULL
);
