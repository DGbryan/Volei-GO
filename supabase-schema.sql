create table if not exists public.players (
  id text primary key,
  name text not null,
  pos text not null default 'QQ',
  level integer not null default 3 check (level between 1 and 5),
  present boolean not null default true,
  sample boolean not null default false,
  at double precision not null
);

create table if not exists public.games (
  id text primary key,
  title text not null,
  date text not null,
  time text not null default '',
  place text not null default '',
  note text not null default '',
  at double precision not null
);

create table if not exists public.app_state (
  doc_key text primary key,
  data jsonb not null
);

alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.app_state enable row level security;

drop policy if exists "Public can read players" on public.players;
create policy "Public can read players"
  on public.players for select to anon, authenticated
  using (true);
drop policy if exists "Admin can manage players" on public.players;
create policy "Admin can manage players"
  on public.players for all to authenticated
  using (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid)
  with check (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid);

drop policy if exists "Public can read games" on public.games;
create policy "Public can read games"
  on public.games for select to anon, authenticated
  using (true);
drop policy if exists "Admin can manage games" on public.games;
create policy "Admin can manage games"
  on public.games for all to authenticated
  using (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid)
  with check (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid);

drop policy if exists "Public can read app state" on public.app_state;
create policy "Public can read app state"
  on public.app_state for select to anon, authenticated
  using (true);
drop policy if exists "Admin can manage app state" on public.app_state;
create policy "Admin can manage app state"
  on public.app_state for all to authenticated
  using (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid)
  with check (auth.uid() = 'be986e70-1192-4900-8fdd-f02f03b9230d'::uuid);

grant usage on schema public to anon, authenticated;
grant select on public.players, public.games, public.app_state
  to anon, authenticated;
grant insert, update, delete on public.players, public.games, public.app_state
  to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end
$$;
