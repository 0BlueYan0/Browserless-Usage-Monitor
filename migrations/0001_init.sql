-- Browserless Usage Monitor — initial schema

CREATE TABLE IF NOT EXISTS tokens (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'cloud',  -- 'cloud' | 'self-hosted'
  endpoint_url  TEXT,                            -- self-hosted fleet base url (cloud: null)
  api_token_enc TEXT NOT NULL,                   -- AES-GCM ciphertext (iv|data, base64)
  account_enc   TEXT,                            -- optional {email,password} ciphertext (login fallback)
  plan_limit    INTEGER NOT NULL,                -- monthly unit allowance
  reset_day     INTEGER NOT NULL DEFAULT 1,      -- billing-cycle reset day-of-month (1..28)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,                -- epoch ms
  updated_at    INTEGER NOT NULL                 -- epoch ms
);

CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id     TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  captured_at  INTEGER NOT NULL,                 -- epoch ms
  period_start INTEGER NOT NULL,                 -- billing period this snapshot belongs to (epoch ms)
  total_units  REAL NOT NULL,
  time_units   REAL,
  proxy_units  REAL,
  captcha_units REAL,
  raw_json     TEXT
);

CREATE INDEX IF NOT EXISTS idx_snap_token_time ON snapshots (token_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_snap_token_period ON snapshots (token_id, period_start);
