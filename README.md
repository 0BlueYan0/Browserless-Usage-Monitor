# Browserless Usage Monitor

自架的 **Cloudflare Pages + Workers** 儀表板 / PWA,用來監控
[browserless.io](https://browserless.io) 多個 API token 的用量:
多 token 管理、目前額度總覽、估算可用天數。

- **頁面**:`/dashboard`、`/settings/tokens`(單頁應用,可安裝成 PWA)
- **前端**:React + Vite + Tailwind v4 + TanStack Query
- **API**:Hono on Pages Functions(`/api/*`)
- **儲存**:Cloudflare D1(token 以 AES-GCM 加密存放)
- **趨勢資料**:獨立的排程 Worker 定期把每日用量寫入同一個 D1
- **認證**:單一密碼登入 + 簽章(HMAC)session cookie

## 用量怎麼讀取

雲端 token 透過 browserless 的 GraphQL **`accountUsage(apiToken, timeframe)`** 查詢讀取
(`https://api.browserless.io/graphql`)。

> **2026-06 實測:** 這個查詢**只需要 API token**(不需要帳號登入 / Bearer)。
> `timeframe` 只接受 `hour` / `day` / `week`,**沒有月份**;`week` 會回傳最近數天的
> **每日用量桶**。因此本 app 會把每日桶**累積**進 D1(`daily_usage`,逐日 upsert),
> 再依帳期重置日把當期的每日量加總,得到「本期已用量」。
> 自架(self-hosted)fleet 改用 `GET {endpoint}/metrics/total`。

注意:因為 API 只回最近一週,**第一個帳期可能少算**(加 token 之前 / 開始監控之前的日子拿不到);
從第二個週期起就完整。方案額度上限(Free 1k / Starter 5k / Scale 25k)**不會**由 API 回傳,
所以每個 token 的每月 unit 額度需要**手動設定**。

## 可用天數估算

- **線性**(資料還不足時的後備):`本期已用量 / 帳期內已過天數`。
- **燃燒率**(有每日資料後優先採用):取最近 7 個「完整日」的每日用量平均當速率。
  卡片上會標示用了哪一種方法。

## 本機開發

```bash
npm install
npm run icons                              # 產生 PWA 圖示(一次即可)
node scripts/gen-secrets.mjs "我的密碼" > .dev.vars   # 產生本機密鑰
npm run db:migrate:local                   # 建立並套用本機 D1 schema

# 同時跑 SPA + Functions(wrangler 會代理 Vite):
npm run dev                                # http://localhost:8788

# (選用)用同一個本機 D1 跑快照 Worker
npm run worker:dev -- --persist-to .wrangler/state
# 手動觸發一次:curl http://localhost:8787/run
```

用你傳給 `gen-secrets` 的密碼登入。

### 測試與檢查

```bash
npm test          # vitest:crypto、session、可用天數計算
npm run typecheck # tsc 檢查 app 與 worker/functions/shared
npm run build     # 正式建置 + 產生 PWA service worker
```

## 部署:Cloudflare 網頁介面(建議)

> 介面選單名稱 Cloudflare 偶爾會調整,以下以 2026 年的版面為準,位置若略有不同請找相近名稱。
> 全程用「Git 連結」自動建置,這樣 Pages Functions 才會被一起編譯部署。

前置:先把這個 repo push 到 GitHub 或 GitLab。

### 步驟 1 — 建立 D1 資料庫並建表
1. 登入 <https://dash.cloudflare.com>。
2. 左側 **Storage & Databases → D1 SQL Database**(或 Workers & Pages → D1)→ **Create**。
3. 名稱填 `browserless-monitor` → **Create**。
4. 進入該資料庫 → **Console** 分頁 → 貼上下面這段(**不含註解**的版本,Console 對註解/多句較敏感)→ **Execute**:
   ```sql
   CREATE TABLE IF NOT EXISTS tokens (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'cloud',
     endpoint_url TEXT,
     api_token_enc TEXT NOT NULL,
     account_enc TEXT,
     plan_limit INTEGER NOT NULL,
     reset_day INTEGER NOT NULL DEFAULT 1,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
     captured_at INTEGER NOT NULL,
     period_start INTEGER NOT NULL,
     total_units REAL NOT NULL,
     time_units REAL,
     proxy_units REAL,
     captcha_units REAL,
     raw_json TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_snap_token_time ON snapshots (token_id, captured_at);
   CREATE INDEX IF NOT EXISTS idx_snap_token_period ON snapshots (token_id, period_start);
   CREATE TABLE IF NOT EXISTS daily_usage (
     token_id   TEXT NOT NULL,
     day_start  INTEGER NOT NULL,
     units      REAL NOT NULL DEFAULT 0,
     successful INTEGER NOT NULL DEFAULT 0,
     proxy      REAL NOT NULL DEFAULT 0,
     captcha    REAL NOT NULL DEFAULT 0,
     seconds    REAL NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (token_id, day_start)
   );
   CREATE INDEX IF NOT EXISTS idx_daily_token_day ON daily_usage (token_id, day_start);
   ```
   應看到建立 `tokens`、`snapshots`、`daily_usage` 三張表成功。
   - 若回 `Requests without any query are not supported`(空查詢):把每個 statement 分開、一句一句 Execute。
   - 或改用 CLI(最保險):`wrangler login` 後執行
     `wrangler d1 migrations apply browserless-monitor --remote`(會套用 migrations/ 下所有檔案)。
5. 在資料庫頁面複製 **Database ID**。
6. 把這個 ID 填進 repo 裡 `wrangler.toml` 與 `worker/wrangler.toml` 兩個檔的 `database_id`,
   然後 commit + push(Database ID 不是機密)。

### 步驟 2 — 產生密鑰值(本機跑一次)
```bash
node scripts/gen-secrets.mjs "你的儀表板密碼"
```
記下印出的 `ENCRYPTION_KEY`、`APP_PASSWORD_HASH`、`SESSION_SECRET` 三個值,待會貼到網頁。

### 步驟 3 — 建立 Pages 專案(SPA + API)
1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → 選你的 repo。
2. 建置設定:
   - **Build command**:`npm run build`
   - **Build output directory**:`dist`
   - Framework preset 可留 *None*。
3. **Save and Deploy**(第一次建置會成功,但還沒綁 D1/密鑰,先繼續)。
4. 進專案 **Settings**:
   - **Variables and Secrets**(變數與密鑰):新增 `ENCRYPTION_KEY`、`APP_PASSWORD_HASH`、
     `SESSION_SECRET` 三個,型別選 **Secret(加密)**,值用步驟 2 的輸出,套用到 **Production**
     (若要用預覽分支也加到 Preview)。
   - **Bindings**(綁定)→ 新增 **D1 database**,變數名稱填 `DB`,選 `browserless-monitor`。
     (`wrangler.toml` 已含此綁定,只要 database_id 正確通常會自動套用;沒有就在這裡手動加。)
5. 回 **Deployments** → 對最新一筆點 **Retry / Redeploy**,讓密鑰與綁定生效。
6. 打開 `https://<專案>.pages.dev` → 用步驟 2 的密碼登入。

### 步驟 4 — 部署排程 Worker(寫用量快照)
> Pages Functions 不能跑 Cron,所以快照交給這個獨立 Worker。

網頁做法(Workers Builds,Git 連結):
1. Dashboard → **Workers & Pages → Create → Workers → Connect to Git** → 匯入同一個 repo。
2. 在建置/部署設定把 **Deploy command** 設成:
   ```
   npx wrangler deploy -c worker/wrangler.toml
   ```
   (Build command 可留空或 `npm install`。)
3. 建立後進該 Worker **Settings**:
   - **Variables and Secrets** → 新增 `ENCRYPTION_KEY`(型別 Secret),值必須和 Pages 那邊**完全相同**。
   - **Bindings** → 確認有 D1 綁定 `DB` 指到 `browserless-monitor`(來自 `worker/wrangler.toml`;沒有就手動加)。
   - **Triggers → Cron Triggers** → 應看到 `0 */6 * * *`(來自設定檔);沒有就手動新增。

兩個專案綁定的是同一個 D1 資料庫(以 `database_id` 為準),所以儀表板與排程 Worker 會自動共用資料。

---

## 部署:Wrangler CLI(替代方案)

```bash
wrangler login

# 1) 建立 D1,把印出的 database_id 填進 wrangler.toml 與 worker/wrangler.toml
npm run db:create
npm run db:migrate:remote

# 2) 設定密鑰(值來自 scripts/gen-secrets.mjs)
wrangler pages secret put ENCRYPTION_KEY
wrangler pages secret put APP_PASSWORD_HASH
wrangler pages secret put SESSION_SECRET
wrangler secret put ENCRYPTION_KEY -c worker/wrangler.toml   # 排程 Worker 用相同金鑰

# 3) 部署
npm run deploy            # 建置 + wrangler pages deploy
npm run worker:deploy     # 部署排程快照 Worker
```

## 專案結構

```
functions/api/[[route]].ts   Hono API(登入、token CRUD、用量)
shared/                      crypto、session、projection、browserless、db、types
src/                         React SPA(pages/、components/、lib/)
worker/                      排程快照 Worker
migrations/                  D1 schema
scripts/                     圖示與密鑰產生器
```

## 範圍說明 / 未實作(YAGNI)

用量告警/推播、CSV 匯出、多使用者/角色、歷史報表圖表,在這個 MVP 階段刻意不做。
