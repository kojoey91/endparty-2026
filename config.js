/* 填入你的 Supabase 專案資料(Project Settings → API)。
   anon key 本來就是公開用的金鑰,放在網頁裡是安全的;真正的權限由資料庫的 RLS 規則控管。
   千萬不要把 service_role key 放進來。 */
window.RAFFLE_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: '貼上 anon public key'
};
