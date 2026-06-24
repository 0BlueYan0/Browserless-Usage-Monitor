# Browserless Usage Monitor

自架的 **Cloudflare Pages + Workers** 儀表板 / PWA,用來監控
[browserless.io](https://browserless.io) 多個 API token 的用量:
多 token 管理、目前額度總覽、估算可用天數。

- **頁面**:`/dashboard`、`/settings/tokens`(單頁應用,可安裝成 PWA)
- **前端**:React + Vite + Tailwind v4 + TanStack Query
- **API**:Hono on Pages Functions(`/api/*`)
- **儲存**:Cloudflare D1(token 以 AES-GCM 加密存放)
- **趨勢資料**:獨立的排程 Worker 定期把用量快照寫入同一個 D1
- **認證**:單一密碼登入 + 簽章(HMAC)session cookie

## 用量怎麼讀取

雲端 token 透過 browserless 的 GraphQL `exportMetrics` 查詢讀取
(`https://api.browserless.io/graphql`)。App 會**先嘗試只帶 token**。

> **2026-06-24 實測:** 只帶 token 會被回 _"An authentication token is required"_ —
> 因此實務上每個雲端 token 還需要一組**帳號登入**(email/密碼),由 `login` mutation
> 換成 `authToken`。請在 Tokens 頁面為各 token 補上(不支援 2FA 帳號)。
> 自架(self-hosted)fleet 改用 `GET {endpoint}/metrics/total`,只需要 token。

方案額度上限(Free 1k / Starter 5k / Scale 25k)**不會**由 API 回傳,
所以每個 token 的每月 unit 額度需要**手動設定**。

## 可用天數估算

- **線性**(立即可用):`已用量 / 帳期內已過天數`。
- **燃燒率**(有快照後優先採用):用排程 Worker 累積的快照,以尾段視窗算近期速率。
  卡片上會標示這個數字是用哪一種方法算出來的。

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

## 部署

1. **建立 D1 資料庫**,把它的 id 填進 `wrangler.toml` 與 `worker/wrangler.toml`:
   ```bash
   npm run db:create
   npm run db:migrate:remote
   ```
2. **設定密鑰**(用 `scripts/gen-secrets.mjs` 產生的值):
   ```bash
   wrangler pages secret put ENCRYPTION_KEY
   wrangler pages secret put APP_PASSWORD_HASH
   wrangler pages secret put SESSION_SECRET
   # 排程 Worker 需要「相同的」加密金鑰:
   wrangler secret put ENCRYPTION_KEY -c worker/wrangler.toml
   ```
3. **部署** Pages app 與排程 Worker:
   ```bash
   npm run deploy            # 建置 + wrangler pages deploy
   npm run worker:deploy     # 部署排程快照 Worker
   ```

兩者綁定同一個 D1 資料庫(以 `database_id` 為準),所以儀表板與排程 Worker
會自動共用資料。

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
