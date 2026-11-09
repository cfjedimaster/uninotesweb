-- Uninote Web — Supabase Postgres Schema & Row Level Security

-- 1. Private schema for internal trigger functions & admin audit data (never exposed via PostgREST)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 2. Tables
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Indexes covering all foreign keys and common sort orders
create index if not exists notebooks_user_id_created_at_idx
  on public.notebooks (user_id, created_at);

create index if not exists notes_user_id_idx
  on public.notes (user_id);

create index if not exists notes_notebook_id_updated_at_idx
  on public.notes (notebook_id, updated_at desc);

-- 4. Maintain updated_at automatically on note edits
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger set_notes_updated_at
  before update on public.notes
  for each row
  execute function private.set_updated_at();

-- 5. Seed a default 'Personal' notebook whenever a new user signs up
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notebooks (user_id, name)
  values (new.id, 'Personal');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created_uninote
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- 6. Table privileges & Row Level Security
revoke all on public.notebooks from anon;
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notebooks to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

alter table public.notebooks enable row level security;
alter table public.notes enable row level security;

create policy "Users can view their own notebooks"
  on public.notebooks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own notebooks"
  on public.notebooks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own notebooks"
  on public.notebooks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own notebooks"
  on public.notebooks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view their own notes"
  on public.notes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create notes in their own notebooks"
  on public.notes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.notebooks nb
      where nb.id = notebook_id
        and nb.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own notes"
  on public.notes
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.notebooks nb
      where nb.id = notebook_id
        and nb.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own notes"
  on public.notes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 7. Login event tracking & bcrypt-gated admin stats RPC
create table if not exists private.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  logged_in_at timestamptz not null default now()
);

create index if not exists login_events_user_id_idx
  on private.login_events (user_id);

create index if not exists login_events_logged_in_at_idx
  on private.login_events (logged_in_at desc);

create or replace function private.record_login_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
begin
  select u.email into user_email
  from auth.users u
  where u.id = new.user_id;

  insert into private.login_events (user_id, email, logged_in_at)
  values (new.user_id, coalesce(user_email, 'Unknown'), coalesce(new.created_at, now()));

  return new;
end;
$$;

create trigger on_auth_session_created_uninote
  after insert on auth.sessions
  for each row
  execute function private.record_login_event();

create table if not exists private.admin_config (
  key text primary key,
  token_hash text not null
);

-- Seed with your random ADMIN_STATS_TOKEN in SQL Editor (never commit the raw token):
-- insert into private.admin_config (key, token_hash)
-- values ('stats', extensions.crypt('<YOUR_ADMIN_STATS_TOKEN>', extensions.gen_salt('bf', 10)))
-- on conflict (key) do update set token_hash = excluded.token_hash;

create or replace function public.get_admin_stats(admin_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
  result jsonb;
begin
  select ac.token_hash into stored_hash
  from private.admin_config ac
  where ac.key = 'stats';

  if stored_hash is null
     or admin_token is null
     or extensions.crypt(admin_token, stored_hash) <> stored_hash then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'userCount', (select count(*) from auth.users),
    'notebookCount', (select count(*) from public.notebooks),
    'noteCount', (select count(*) from public.notes),
    'recentLogins', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', le.id,
            'email', le.email,
            'loggedInAt', le.logged_in_at
          )
          order by le.logged_in_at desc, le.id desc
        )
        from (
          select id, email, logged_in_at
          from private.login_events
          order by logged_in_at desc, id desc
          limit 10
        ) le
      ),
      '[]'::jsonb
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_admin_stats(text) to anon, authenticated;
