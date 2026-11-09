-- Uninote Web — Supabase Postgres Schema & Row Level Security

-- 1. Private schema for internal trigger functions (never exposed via PostgREST)
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

drop trigger if exists set_notes_updated_at on public.notes;
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

drop trigger if exists on_auth_user_created_uninote on auth.users;
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

-- Notebooks policies
drop policy if exists "Users can view their own notebooks" on public.notebooks;
create policy "Users can view their own notebooks"
  on public.notebooks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own notebooks" on public.notebooks;
create policy "Users can create their own notebooks"
  on public.notebooks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own notebooks" on public.notebooks;
create policy "Users can update their own notebooks"
  on public.notebooks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own notebooks" on public.notebooks;
create policy "Users can delete their own notebooks"
  on public.notebooks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Notes policies
drop policy if exists "Users can view their own notes" on public.notes;
create policy "Users can view their own notes"
  on public.notes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create notes in their own notebooks" on public.notes;
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

drop policy if exists "Users can update their own notes" on public.notes;
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

drop policy if exists "Users can delete their own notes" on public.notes;
create policy "Users can delete their own notes"
  on public.notes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
