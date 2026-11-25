-- 尾牙摸彩兌獎站 — Supabase schema
-- 在 Supabase 專案的 SQL Editor 整份貼上執行一次即可。重複執行也不會出錯。

-- ============ 資料表 ============

-- 活動設定(只有一列)
create table if not exists public.settings (
  id          int primary key default 1 check (id = 1),
  event_name  text not null default '2026年終尾牙',
  claim_note  text not null default '請攜帶存根聯到兌獎處核對領獎，需簽名',
  final       boolean not null default false,   -- 名單已全部公布
  show_names  boolean not null default false,   -- 員工頁顯示中獎者姓名與部門
  share_url   text not null default '',
  updated_at  timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 工作人員名單:只有這裡列出的 Email 能登錄、修改、看名冊
create table if not exists public.staff (
  email text primary key check (email = lower(email))
);

-- 員工名冊(只有工作人員讀得到)
create table if not exists public.roster (
  emp_id text primary key check (emp_id ~ '^[A-Z0-9]{6}$'),
  name   text not null default '',
  dept   text not null default ''
);

-- 中獎名單:員編是主鍵,同一個員編在資料庫層級就不可能登錄兩次
create table if not exists public.winners (
  emp_id     text primary key check (emp_id ~ '^[A-Z0-9]{6}$'),
  prize      smallint not null check (prize in (5, 6)),   -- 5 = 五獎 $2,000、6 = 六獎 $1,000
  drawn_at   timestamptz not null default now(),
  name       text,      -- 只在 settings.show_names = true 時由觸發器帶入
  dept       text,
  created_by text
);
create index if not exists winners_drawn_at_idx on public.winners (drawn_at);

-- ============ 權限 ============

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.settings enable row level security;
alter table public.staff    enable row level security;
alter table public.roster   enable row level security;
alter table public.winners  enable row level security;

drop policy if exists "settings read"  on public.settings;
drop policy if exists "settings write" on public.settings;
create policy "settings read"  on public.settings for select to anon, authenticated using (true);
create policy "settings write" on public.settings for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff read own" on public.staff;
create policy "staff read own" on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "roster staff all" on public.roster;
create policy "roster staff all" on public.roster for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "winners read"   on public.winners;
drop policy if exists "winners insert" on public.winners;
drop policy if exists "winners update" on public.winners;
drop policy if exists "winners delete" on public.winners;
create policy "winners read"   on public.winners for select to anon, authenticated using (true);
create policy "winners insert" on public.winners for insert to authenticated with check (public.is_staff());
create policy "winners update" on public.winners for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "winners delete" on public.winners for delete to authenticated using (public.is_staff());

-- ============ 姓名與部門自動帶入 ============
-- 員工頁是公開的,所以只有「中獎者」且「開關打開」時,才把姓名部門複製到 winners;
-- 整份名冊永遠只在 roster 表、只有工作人員讀得到。

create or replace function public.winners_fill_names() returns trigger
language plpgsql security definer set search_path = public as $$
declare on_ boolean; r record;
begin
  new.emp_id := upper(new.emp_id);
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.jwt() ->> 'email', new.created_by); end if;
  select show_names into on_ from public.settings where id = 1;
  if coalesce(on_, false) then
    select name, dept into r from public.roster where emp_id = new.emp_id;
    new.name := nullif(r.name, ''); new.dept := nullif(r.dept, '');
  else
    new.name := null; new.dept := null;
  end if;
  return new;
end $$;

drop trigger if exists winners_fill_names on public.winners;
create trigger winners_fill_names before insert or update of emp_id, prize on public.winners
  for each row execute function public.winners_fill_names();

create or replace function public.refresh_winner_names() returns void
language plpgsql security definer set search_path = public as $$
declare on_ boolean;
begin
  select show_names into on_ from public.settings where id = 1;
  if coalesce(on_, false) then
    update public.winners w set name = nullif(r.name, ''), dept = nullif(r.dept, '')
      from public.roster r
     where r.emp_id = w.emp_id
       and (w.name is distinct from nullif(r.name, '') or w.dept is distinct from nullif(r.dept, ''));
    update public.winners w set name = null, dept = null
     where (w.name is not null or w.dept is not null)
       and not exists (select 1 from public.roster r where r.emp_id = w.emp_id);
  else
    update public.winners set name = null, dept = null where name is not null or dept is not null;
  end if;
end $$;

create or replace function public.on_settings_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.on_settings_change();

create or replace function public.after_names_source_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_winner_names();
  return null;
end $$;

drop trigger if exists settings_names on public.settings;
create trigger settings_names after update of show_names on public.settings
  for each statement execute function public.after_names_source_change();

drop trigger if exists roster_names on public.roster;
create trigger roster_names after insert or update or delete on public.roster
  for each statement execute function public.after_names_source_change();

-- ============ 即時更新 ============
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'winners') then
    execute 'alter publication supabase_realtime add table public.winners';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settings') then
    execute 'alter publication supabase_realtime add table public.settings';
  end if;
end $$;

-- ============ 最後一步:加入工作人員 ============
-- 把下面的 Email 換成工作人員的 Email(小寫),每人一列,再執行這一段。
-- insert into public.staff (email) values
--   ('you@example.com'),
--   ('coworker@example.com')
-- on conflict do nothing;
