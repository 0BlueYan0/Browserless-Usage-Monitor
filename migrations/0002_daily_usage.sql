-- Per-day usage buckets accumulated from accountUsage(timeframe: week).
-- The cloud API only exposes hour/day/week windows, so we upsert each day's
-- bucket over time and sum within the billing period to get the monthly total.

CREATE TABLE IF NOT EXISTS daily_usage (
  token_id   TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  day_start  INTEGER NOT NULL,                -- UTC midnight of the bucket (epoch ms)
  units      REAL NOT NULL DEFAULT 0,
  successful INTEGER NOT NULL DEFAULT 0,
  proxy      REAL NOT NULL DEFAULT 0,
  captcha    REAL NOT NULL DEFAULT 0,
  seconds    REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, day_start)
);

CREATE INDEX IF NOT EXISTS idx_daily_token_day ON daily_usage (token_id, day_start);
