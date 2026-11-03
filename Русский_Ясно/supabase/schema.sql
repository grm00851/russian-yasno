-- Run this in Supabase Dashboard -> SQL Editor.
create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

revoke all on public.user_progress from anon;
grant select, insert, update on public.user_progress to authenticated;

drop policy if exists "Users can read their own progress" on public.user_progress;
create policy "Users can read their own progress"
  on public.user_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own progress" on public.user_progress;
create policy "Users can insert their own progress"
  on public.user_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own progress" on public.user_progress;
create policy "Users can update their own progress"
  on public.user_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
