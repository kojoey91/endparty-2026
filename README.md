# 尾牙摸彩兌獎站

工作人員在現場登錄抽出的中獎員編，員工掃 QR Code 查詢自己有沒有中獎。

- 員工查詢頁：`https://<你的帳號>.github.io/<repo 名稱>/`
- 工作人員管理頁：`https://<你的帳號>.github.io/<repo 名稱>/admin.html`

網頁放在 GitHub Pages（免費、只放程式碼），資料放在 Supabase（免費方案即可）。
**中獎名單、員工名冊都只存在 Supabase，不會進到 GitHub repo。**

---

## 一、建立 Supabase 資料庫（約 10 分鐘）

1. 到 <https://supabase.com> 註冊並按 **New project**。
   - Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，離台灣近。
   - Project name 可以填 `endparty-2026`。
   - Database password 按 **Generate a password**，複製存好（之後用不太到）。
   - Data access：**Enable Data API** 要勾；另外兩項（Grant API access…、Enable RLS…）勾不勾都可以，`schema.sql` 會自己設定好。
2. 專案建好後，左側選 **SQL Editor** → **New query**，把 `supabase/schema.sql` 整份貼上 → 按 **Run**。看到 `Success` 就完成。
3. 關閉自由註冊（很重要，否則任何人都能自己註冊帳號）：
   左側 **Authentication** → **Sign In / Providers**（或 Settings）→ 把 **Allow new users to sign up** 關掉 → Save。
4. 建立工作人員帳號：
   **Authentication** → **Users** → **Add user** → **Create new user**，填 Email 和密碼，勾選 **Auto Confirm User**。每位工作人員各建一個。
5. 把工作人員加進名單（只有名單上的人能登錄、看名冊）：回到 **SQL Editor** 執行，Email 一律小寫：
   ```sql
   insert into public.staff (email) values
     ('joey@example.com'),
     ('coworker@example.com')
   on conflict do nothing;
   ```
6. 拿連線資料：左側 **Project Settings** → **API Keys**，複製 **Publishable key**（`sb_publishable_` 開頭）。
   Project URL 就是 `https://<Project ID>.supabase.co`（Project ID 在 Project Settings → General）。

## 二、填設定檔

打開 repo 裡的 `config.js`，把剛剛複製的兩個值貼上：

```js
window.RAFFLE_CONFIG = {
  SUPABASE_URL: 'https://abcd1234.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...'
};
```

> Publishable key 本來就是給網頁用的公開金鑰，放在公開 repo 沒問題；誰能讀、誰能寫由資料庫的規則（RLS）控管。
> **絕對不要**把 Secret key（`sb_secret_` 開頭）或舊的 `service_role` key 放進任何檔案。

## 三、發布到 GitHub Pages（約 5 分鐘）

1. 在 GitHub 建一個新的 **Public** repo（例如 `raffle-2026`），不用勾選任何初始檔案。
2. 在 repo 頁面按 **uploading an existing file**，把這個資料夾裡的**所有檔案和資料夾**拖進去（包含 `assets/`、`supabase/`、`.nojekyll`），按 **Commit changes**。
   - `.nojekyll` 是隱藏檔，Mac 在 Finder 按 `Cmd + Shift + .` 就看得到。
3. repo 的 **Settings** → **Pages** → Source 選 **Deploy from a branch** → Branch 選 `main`、資料夾選 `/ (root)` → Save。
4. 等 1～2 分鐘，頁面上方會出現網址 `https://<帳號>.github.io/<repo>/`。

## 四、上線前設定

1. 打開 `.../admin.html`，用工作人員帳號登入。
2. **名單設定**：
   - 確認活動名稱、領獎說明。
   - 按 **使用這個網站的查詢頁網址** → 下方會產生 QR Code → **儲存 SVG（印刷用）** 給印刷廠。
   - **員工名冊**：按「下載 CSV 範本」，照「員編、姓名、部門」填好後匯入。Excel 存的中文 CSV 不用轉檔。
   - 要不要在員工頁顯示中獎者姓名與部門，用「員工頁顯示」切換（預設只顯示員編）。
3. 用一支**沒登入任何帳號的手機**掃 QR Code，確認看得到查詢頁；在管理頁登錄一筆測試員編，看手機是否在幾秒內更新、跳出中獎通知，測完刪掉。

## 五、活動當天

- 工作人員打開 `admin.html` → 點獎項 → 輸入員編、姓名或部門 → `Enter`。
- 同一個員編只能登錄一次：畫面會先提示，資料庫也會擋（員編是主鍵）。
- 打錯可以按「復原」（12 秒內），或在右側名單「修改」「刪除」。
- 全部抽完後：**名單設定** → 「名單已全部公布」，沒中獎的員工會看到明確結果。
- 結束後在右側名單按 **匯出 CSV** 交給兌獎處（含姓名、部門）。

## 注意事項

- **Supabase 免費專案閒置 7 天會自動暫停。** 活動前一兩天請登入 Supabase 確認專案是 Active，若顯示 Paused 按 Restore。
- 免費方案的即時連線上限約 200 人同時；超過的員工頁會自動改成每 10 秒更新一次，不影響查詢結果，只是慢幾秒。
- 員工查詢頁是公開的：任何拿到網址的人都看得到中獎員編（開啟姓名顯示時也會看到中獎者姓名與部門）。整份員工名冊只有工作人員讀得到。
- 上傳員工名冊前，請先確認公司對員工個資存放在外部服務的規定。活動結束、資料用完後建議清除：
  ```sql
  truncate public.winners;
  delete from public.roster;
  ```
  或直接在 Supabase 刪除整個專案。

## 清掉測試資料

在 Supabase **SQL Editor** 執行：

```sql
truncate public.winners;                                   -- 清空中獎名單
update public.settings set final = false where id = 1;    -- 改回「抽獎進行中」
```

## 檔案說明

| 檔案 | 用途 |
|------|------|
| `index.html` | 員工查詢頁 |
| `admin.html` | 工作人員管理頁（要登入） |
| `config.js` | Supabase 連線設定（要自己填） |
| `assets/app.js` | 網站程式 |
| `assets/style.css` | 樣式（新野獸派） |
| `assets/logo.svg` | 公司 Logo |
| `supabase/schema.sql` | 資料表、權限規則、姓名自動帶入、即時更新設定 |
| `員工名冊範本.csv` | 名冊匯入範本 |

獎項、金額、名額寫在 `assets/app.js` 最上面的 `PRIZES`。改的話也要同步修改 `supabase/schema.sql` 裡 `prize in (5, 6)` 的限制。
