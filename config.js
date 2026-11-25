/* 填入你的 Supabase 專案資料(Project Settings → API Keys)。
   SUPABASE_KEY 填 Publishable key(sb_publishable_ 開頭),它本來就是給網頁公開用的,放在這裡是安全的;
   真正的權限由資料庫的 RLS 規則控管。千萬不要把 Secret key(sb_secret_ 開頭)放進來。 */
window.RAFFLE_CONFIG = {
  SUPABASE_URL: 'https://zukdksmwbfpmcpriyule.supabase.co',
  SUPABASE_ANON_KEY: '貼上 Publishable key'
};
