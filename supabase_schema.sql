-- ============================================================
-- LoveWords — paste this entire file into:
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Profiles (one row per user, auto-linked to auth)
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  display_name text not null,
  expo_push_token text,
  created_at timestamptz default now()
);

-- Games
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  player1_uid uuid not null references profiles(id),
  player2_uid uuid not null references profiles(id),
  players jsonb not null,
  board jsonb not null,
  bag jsonb not null,
  current_turn uuid not null,
  status text not null default 'active',
  mode text not null default 'partner',   -- 'partner' | 'friend'
  moves jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Migration for existing installs (safe to re-run) ────────────────────────
-- If the games table predates the Partner/Friend feature, add the mode column.
-- Existing rows default to partner.
alter table games add column if not exists mode text not null default 'partner';

-- Analysis-only event details are captured here before hidden rack/draw/return
-- fields are removed from participant-readable games.moves. event_index is
-- zero-based so it matches the JSON array position exactly.
create table if not exists game_analysis_events (
  game_id uuid not null references games(id) on delete cascade,
  event_index integer not null check (event_index >= 0),
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, event_index)
);

-- Capture full newly appended v2 events and sanitize the public copy in the
-- same transaction. Provenance is immutable: only games created with both
-- player entries marked historyVersion=2 may retain that marker.
create or replace function public.capture_game_analysis_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_event_count integer;
  new_event_count integer;
  new_event_index integer;
  full_event jsonb;
begin
  if jsonb_typeof(new.moves) <> 'array' then
    raise exception 'games.moves must be a JSON array';
  end if;

  old_event_count := jsonb_array_length(coalesce(old.moves, '[]'::jsonb));
  new_event_count := jsonb_array_length(new.moves);

  if new_event_count > old_event_count then
    for new_event_index in old_event_count..new_event_count - 1 loop
      full_event := new.moves -> new_event_index;
      if full_event ->> 'version' = '2' then
        insert into public.game_analysis_events (game_id, event_index, event)
        values (new.id, new_event_index, full_event)
        on conflict (game_id, event_index) do nothing;
      end if;
    end loop;
  end if;

  select coalesce(
    jsonb_agg(
      item - 'rackBefore' - 'drawnTiles' - 'returnedTiles'
      order by ordinal
    ),
    '[]'::jsonb
  )
  into new.moves
  from jsonb_array_elements(new.moves) with ordinality as public_events(item, ordinal);

  if
    old.players #>> '{0,historyVersion}' = '2'
    and old.players #>> '{1,historyVersion}' = '2'
  then
    new.players := jsonb_set(
      jsonb_set(new.players, '{0,historyVersion}', '2'::jsonb, true),
      '{1,historyVersion}',
      '2'::jsonb,
      true
    );
  else
    new.players := jsonb_build_array(
      (new.players -> 0) - 'historyVersion',
      (new.players -> 1) - 'historyVersion'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists capture_game_analysis_events_before_update on games;
create trigger capture_game_analysis_events_before_update
  before update of moves, players on games
  for each row execute function public.capture_game_analysis_events();

-- One-time/idempotent backfill for games that recorded v2 events before this
-- private table existed. These games intentionally keep no provenance marker,
-- so their exports remain conservative `basic` histories.
insert into game_analysis_events (game_id, event_index, event)
select
  games.id,
  (events.ordinal - 1)::integer,
  events.item
from games
cross join lateral jsonb_array_elements(games.moves)
  with ordinality as events(item, ordinal)
where events.item ->> 'version' = '2'
on conflict (game_id, event_index) do nothing;

update games
set moves = (
  select coalesce(
    jsonb_agg(
      item - 'rackBefore' - 'drawnTiles' - 'returnedTiles'
      order by ordinal
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(games.moves)
    with ordinality as public_events(item, ordinal)
)
where exists (
  select 1
  from jsonb_array_elements(games.moves) as existing_events(item)
  where existing_events.item ?| array['rackBefore', 'drawnTiles', 'returnedTiles']
);

-- Love Notes
create table if not exists love_notes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  from_uid uuid not null references profiles(id),
  to_uid uuid not null references profiles(id),
  message text not null,
  emoji text not null default '💕',
  read boolean not null default false,
  created_at timestamptz default now()
);

-- ── Row Level Security ──────────────────────────────────────

alter table profiles enable row level security;
alter table games enable row level security;
alter table game_analysis_events enable row level security;
alter table love_notes enable row level security;

-- Profiles: anyone logged in can read, only you can write yours
create policy "profiles_read" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- ── Auto-create profile on signup ───────────────────────────
-- Runs server-side with elevated rights, so it works even when
-- email-confirmation is on and the client has no session yet.
-- This replaces the client-side profiles insert in authService.ts.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Games: only players in the game can see/edit it
create policy "games_read" on games for select
  using (auth.uid() = player1_uid or auth.uid() = player2_uid);

create policy "games_insert" on games for insert
  with check (auth.uid() = player1_uid);

create policy "games_update" on games for update
  using (auth.uid() = player1_uid or auth.uid() = player2_uid);

-- Analysis events are backend-only. No client role receives a policy or table
-- privilege; the service-role export function is the only reader.
drop policy if exists "finished_game_analysis_events_read" on game_analysis_events;
revoke all on table game_analysis_events from public, anon, authenticated;
grant select on table game_analysis_events to service_role;
revoke execute on function public.capture_game_analysis_events()
  from public, anon, authenticated;

-- Love notes: only players in the related game
create policy "notes_read" on love_notes for select
  using (auth.uid() = from_uid or auth.uid() = to_uid);

create policy "notes_insert" on love_notes for insert
  with check (auth.uid() = from_uid);

create policy "notes_update" on love_notes for update
  using (auth.uid() = to_uid);

-- ── Realtime ────────────────────────────────────────────────
-- Enable realtime for live game updates and love notes
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table love_notes;
