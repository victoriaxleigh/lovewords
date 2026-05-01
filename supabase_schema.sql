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
  moves jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
alter table love_notes enable row level security;

-- Profiles: anyone logged in can read, only you can write yours
create policy "profiles_read" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Games: only players in the game can see/edit it
create policy "games_read" on games for select
  using (auth.uid() = player1_uid or auth.uid() = player2_uid);

create policy "games_insert" on games for insert
  with check (auth.uid() = player1_uid);

create policy "games_update" on games for update
  using (auth.uid() = player1_uid or auth.uid() = player2_uid);

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
