-- ============================================================
-- LoveWords — paste this entire file into:
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Profiles (one row per user, auto-linked to auth)
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  display_name text not null,
  discoverable boolean not null default false,
  has_paid boolean not null default false,
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
  rematch_of uuid references games(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Migration for existing installs (safe to re-run) ────────────────────────
-- If the games table predates the Partner/Friend feature, add the mode column.
-- Existing rows default to partner.
alter table games add column if not exists mode text not null default 'partner';
alter table profiles add column if not exists discoverable boolean not null default false;
alter table profiles add column if not exists has_paid boolean not null default false;
alter table games add column if not exists rematch_of uuid references games(id) on delete set null;

create unique index if not exists games_one_rematch_per_source_idx
  on games (rematch_of)
  where rematch_of is not null;

create index if not exists profiles_discoverable_display_name_prefix_idx
  on profiles (lower(display_name) text_pattern_ops)
  where discoverable;

create table if not exists profile_email_lookup_limits (
  caller_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.profile_email_lookup_limits enable row level security;
revoke all on table public.profile_email_lookup_limits from public, anon, authenticated;
grant all on table public.profile_email_lookup_limits to service_role;

create table if not exists game_creation_grants (
  creator_uid uuid not null references auth.users(id) on delete cascade,
  opponent_uid uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (creator_uid, opponent_uid)
);

alter table public.game_creation_grants enable row level security;
revoke all on table public.game_creation_grants from public, anon, authenticated;
grant all on table public.game_creation_grants to service_role;

create table if not exists notification_rate_limits (
  sender_uid uuid not null references auth.users(id) on delete cascade,
  recipient_uid uuid not null references auth.users(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('invite', 'turn', 'lovenote', 'nudge')),
  window_started timestamptz not null default now(),
  last_delivered_at timestamptz not null default now(),
  deliveries integer not null default 1 check (deliveries > 0),
  primary key (sender_uid, recipient_uid, notification_type)
);

create table if not exists notification_delivery_events (
  sender_uid uuid not null references auth.users(id) on delete cascade,
  recipient_uid uuid not null references auth.users(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('invite', 'turn', 'lovenote')),
  event_key text not null check (char_length(event_key) between 1 and 160),
  delivered_at timestamptz not null default now(),
  primary key (sender_uid, recipient_uid, notification_type, event_key)
);

alter table public.notification_rate_limits enable row level security;
alter table public.notification_delivery_events enable row level security;
revoke all on table public.notification_rate_limits from public, anon, authenticated;
revoke all on table public.notification_delivery_events from public, anon, authenticated;
grant all on table public.notification_rate_limits to service_role;
grant all on table public.notification_delivery_events to service_role;

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

-- Profiles are private by default. Public discovery and exact-email lookup
-- expose narrowly scoped fields through the security-definer functions below.
drop policy if exists "profiles_read" on profiles;
drop policy if exists "profiles_owner_read" on profiles;
drop policy if exists "profiles_insert" on profiles;
drop policy if exists "profiles_update" on profiles;
create policy "profiles_owner_read" on profiles for select using (auth.uid() = id);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on table profiles from public, anon, authenticated;
grant update (discoverable, expo_push_token, has_paid) on table profiles to authenticated;

-- Love-note identity/content is immutable because its ID authorizes one push.
revoke update on table love_notes from public, anon, authenticated;
grant update ("read") on table love_notes to authenticated;

create or replace function public.search_profiles(search_query text)
returns table (profile_id uuid, display_name text, player_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_query text := trim(search_query);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(normalized_query) < 3 then
    raise exception 'Search query must be at least 3 characters';
  end if;

  return query
  select
    p.id,
    p.display_name,
    upper(right(replace(p.id::text, '-', ''), 6))
  from public.profiles p
  where p.discoverable
    and p.id <> auth.uid()
    and starts_with(lower(p.display_name), lower(normalized_query))
  order by lower(p.display_name), p.id
  limit 20;
end;
$$;

create or replace function public.claim_notification_delivery(
  claim_sender_uid uuid,
  claim_recipient_uid uuid,
  claim_notification_type text,
  claim_event_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rate_state public.notification_rate_limits%rowtype;
  claim_time timestamptz := clock_timestamp();
  cooldown interval;
  hourly_limit integer;
begin
  if claim_notification_type not in ('invite', 'turn', 'lovenote', 'nudge') then
    return false;
  end if;
  if char_length(claim_event_key) not between 1 and 160 then
    return false;
  end if;
  cooldown := case claim_notification_type
    when 'invite' then interval '5 seconds'
    when 'nudge' then interval '1 hour'
    else interval '1 second'
  end;
  hourly_limit := case claim_notification_type
    when 'invite' then 10
    when 'nudge' then 2
    when 'turn' then 30
    else 30
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(
      claim_sender_uid::text || ':' || claim_recipient_uid::text || ':' ||
      claim_notification_type,
      0
    )
  );

  if claim_notification_type <> 'nudge' and exists (
    select 1
    from public.notification_delivery_events
    where sender_uid = claim_sender_uid
      and recipient_uid = claim_recipient_uid
      and notification_type = claim_notification_type
      and event_key = claim_event_key
  ) then
    return false;
  end if;

  select *
  into rate_state
  from public.notification_rate_limits
  where sender_uid = claim_sender_uid
    and recipient_uid = claim_recipient_uid
    and notification_type = claim_notification_type
  for update;

  if not found then
    insert into public.notification_rate_limits (
      sender_uid, recipient_uid, notification_type,
      window_started, last_delivered_at, deliveries
    )
    values (
      claim_sender_uid, claim_recipient_uid, claim_notification_type,
      claim_time, claim_time, 1
    );
  else
    if rate_state.last_delivered_at > claim_time - cooldown then
      return false;
    end if;
    if rate_state.window_started <= claim_time - interval '1 hour' then
      update public.notification_rate_limits
      set window_started = claim_time, last_delivered_at = claim_time, deliveries = 1
      where sender_uid = claim_sender_uid
        and recipient_uid = claim_recipient_uid
        and notification_type = claim_notification_type;
    elsif rate_state.deliveries >= hourly_limit then
      return false;
    else
      update public.notification_rate_limits
      set last_delivered_at = claim_time, deliveries = deliveries + 1
      where sender_uid = claim_sender_uid
        and recipient_uid = claim_recipient_uid
        and notification_type = claim_notification_type;
    end if;
  end if;

  if claim_notification_type <> 'nudge' then
    insert into public.notification_delivery_events (
      sender_uid, recipient_uid, notification_type, event_key, delivered_at
    )
    values (
      claim_sender_uid, claim_recipient_uid, claim_notification_type, claim_event_key, claim_time
    );
  end if;
  return true;
end;
$$;

drop function if exists public.find_profile_by_email(text);
create function public.find_profile_by_email(lookup_email text)
returns table (id uuid, display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lookup_attempts integer;
  matched_id uuid;
  matched_display_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.profile_email_lookup_limits (caller_id, window_started, attempts)
  values (auth.uid(), clock_timestamp(), 1)
  on conflict (caller_id) do update
  set
    window_started = case
      when profile_email_lookup_limits.window_started < clock_timestamp() - interval '1 hour'
        then clock_timestamp()
      else profile_email_lookup_limits.window_started
    end,
    attempts = case
      when profile_email_lookup_limits.window_started < clock_timestamp() - interval '1 hour'
        then 1
      else profile_email_lookup_limits.attempts + 1
    end
  returning attempts into lookup_attempts;

  if lookup_attempts > 20 then
    return;
  end if;

  select p.id, p.display_name
  into matched_id, matched_display_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(lookup_email))
  limit 1;

  if matched_id is null or matched_id = auth.uid() then
    return;
  end if;

  insert into public.game_creation_grants (creator_uid, opponent_uid, expires_at)
  values (auth.uid(), matched_id, clock_timestamp() + interval '5 minutes')
  on conflict (creator_uid, opponent_uid) do update
  set expires_at = excluded.expires_at;

  return query select matched_id, matched_display_name;
end;
$$;

create or replace function public.create_active_game(
  game_players jsonb,
  game_board jsonb,
  game_bag jsonb,
  game_current_turn uuid,
  game_mode text,
  email_grant boolean default false,
  source_game_id uuid default null,
  solo_game boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  player1_id uuid;
  player2_id uuid;
  player1_name text;
  player2_name text;
  granted_opponent_id uuid;
  source_game public.games%rowtype;
  sanitized_players jsonb;
  created_game_id uuid;
  creation_reasons integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(game_players) is distinct from 'array'
    or jsonb_array_length(game_players) is distinct from 2
  then
    raise exception 'Exactly two players are required';
  end if;

  begin
    player1_id := (game_players #>> '{0,uid}')::uuid;
    player2_id := (game_players #>> '{1,uid}')::uuid;
  exception when others then
    raise exception 'Invalid player identity';
  end;

  creation_reasons :=
    case when solo_game then 1 else 0 end +
    case when email_grant then 1 else 0 end +
    case when source_game_id is not null then 1 else 0 end;
  if creation_reasons <> 1 then
    raise exception 'Choose exactly one game creation reason';
  end if;

  if solo_game then
    if player1_id <> caller_id or player2_id <> caller_id or game_mode <> 'partner' then
      raise exception 'Invalid solo game participants';
    end if;
  elsif email_grant then
    delete from public.game_creation_grants
    where creator_uid = caller_id
      and opponent_uid = player2_id
      and expires_at > clock_timestamp()
    returning opponent_uid into granted_opponent_id;
    if granted_opponent_id is null
      or granted_opponent_id = caller_id
      or player1_id <> caller_id
    then
      raise exception 'Email lookup grant does not authorize these participants';
    end if;
  else
    select * into source_game from public.games where id = source_game_id;
    if not found
      or source_game.status <> 'finished'
      or caller_id not in (source_game.player1_uid, source_game.player2_uid)
      or not (
        (player1_id = source_game.player1_uid and player2_id = source_game.player2_uid)
        or
        (player1_id = source_game.player2_uid and player2_id = source_game.player1_uid)
      )
      or game_mode <> source_game.mode
    then
      raise exception 'Source game does not authorize this rematch';
    end if;
  end if;

  select p.display_name into player1_name from public.profiles p where p.id = player1_id;
  select p.display_name into player2_name from public.profiles p where p.id = player2_id;
  if player1_name is null or player2_name is null then
    raise exception 'Player profile not found';
  end if;

  sanitized_players := jsonb_build_array(
    (game_players -> 0) - 'uid' - 'displayName' - 'email' ||
      jsonb_build_object('uid', player1_id, 'displayName', player1_name, 'email', ''),
    (game_players -> 1) - 'uid' - 'displayName' - 'email' ||
      jsonb_build_object(
        'uid', player2_id,
        'displayName', case when solo_game then 'Player 2 🎯' else player2_name end,
        'email', case when solo_game then 'solo' else '' end
      )
  );

  perform set_config('app.active_game_creation', 'authorized', true);
  begin
    insert into public.games (
      player1_uid, player2_uid, players, board, bag, current_turn,
      status, mode, moves, rematch_of
    )
    values (
      player1_id, player2_id, sanitized_players, game_board, game_bag, game_current_turn,
      'active', game_mode, '[]'::jsonb, source_game_id
    )
    returning id into created_game_id;
  exception when unique_violation then
    -- Both players can tap Rematch on the same finished game. Only one rematch
    -- per source is allowed (games_one_rematch_per_source_idx); route the loser
    -- of that race into the rematch that already exists rather than surfacing a
    -- duplicate-key error to the client.
    if source_game_id is null then
      raise;
    end if;
    select id into created_game_id
    from public.games
    where rematch_of = source_game_id;
    if created_game_id is null then
      raise;
    end if;
  end;

  return created_game_id;
end;
$$;

drop index if exists games_outgoing_invite_rate_idx;
create index games_outgoing_invite_rate_idx
  on games (player1_uid, created_at)
  where players #>> '{0,email}' = '';

create or replace function public.enforce_game_invitation_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pair_lock bigint;
  sender_lock bigint;
begin
  if tg_op = 'INSERT' then
    if new.status = 'waiting' then
      if auth.uid() is null or auth.uid() <> new.player1_uid then
        raise exception 'Only the inviter can create an invitation';
      end if;
      if new.player1_uid = new.player2_uid then
        raise exception 'Cannot invite yourself';
      end if;
      sender_lock := hashtextextended('invite-sender:' || new.player1_uid::text, 0);
      perform pg_advisory_xact_lock(sender_lock);
      pair_lock := hashtextextended(
        least(new.player1_uid, new.player2_uid)::text || ':' ||
        greatest(new.player1_uid, new.player2_uid)::text,
        0
      );
      perform pg_advisory_xact_lock(pair_lock);
      if exists (
        select 1 from public.games g
        where g.status = 'waiting'
          and least(g.player1_uid, g.player2_uid) = least(new.player1_uid, new.player2_uid)
          and greatest(g.player1_uid, g.player2_uid) = greatest(new.player1_uid, new.player2_uid)
      ) then
        raise exception 'A pending invitation already exists between these players';
      end if;
      if (
        select count(*) from public.games g
        where g.player1_uid = auth.uid()
          and g.players #>> '{0,email}' = ''
          and g.created_at >= clock_timestamp() - interval '1 hour'
      ) >= 10 then
        raise exception 'Too many invitations; try again later';
      end if;

      new.created_at := clock_timestamp();
      new.updated_at := new.created_at;
      if
        new.current_turn is distinct from new.player1_uid
        or new.bag is distinct from '[]'::jsonb
        or new.moves is distinct from '[]'::jsonb
        or jsonb_typeof(new.players) is distinct from 'array'
        or jsonb_array_length(new.players) is distinct from 2
        or new.players #>> '{0,uid}' is distinct from new.player1_uid::text
        or new.players #>> '{1,uid}' is distinct from new.player2_uid::text
        or jsonb_typeof(new.players #> '{0,rack}') is distinct from 'array'
        or jsonb_typeof(new.players #> '{1,rack}') is distinct from 'array'
        or jsonb_array_length(new.players #> '{0,rack}') is distinct from 0
        or jsonb_array_length(new.players #> '{1,rack}') is distinct from 0
        or coalesce((new.players #>> '{0,score}')::integer, -1) <> 0
        or coalesce((new.players #>> '{1,score}')::integer, -1) <> 0
        or new.players #>> '{0,historyVersion}' is distinct from '2'
        or new.players #>> '{1,historyVersion}' is distinct from '2'
        or new.players #>> '{0,email}' is distinct from ''
        or new.players #>> '{1,email}' is distinct from ''
        or jsonb_typeof(new.board) is distinct from 'array'
        or jsonb_array_length(new.board) is distinct from 15
        or exists (
          select 1 from jsonb_array_elements(new.board) as board_rows(row_value)
          where jsonb_typeof(row_value) is distinct from 'array'
            or jsonb_array_length(row_value) is distinct from 15
        )
        or exists (
          select 1
          from jsonb_array_elements(new.board) as board_rows(row_value)
          cross join lateral jsonb_array_elements(board_rows.row_value) as board_cells(cell_value)
          where board_cells.cell_value -> 'tile' is distinct from 'null'::jsonb
        )
      then
        raise exception 'Invalid waiting invitation shape';
      end if;
      return new;
    end if;

    if new.status is distinct from 'active' then
      raise exception 'New games must be active games or waiting invitations';
    end if;
    if current_setting('app.active_game_creation', true) is distinct from 'authorized' then
      raise exception 'Active games must be created through create_active_game';
    end if;

    if
      new.current_turn is distinct from new.player1_uid
      or new.moves is distinct from '[]'::jsonb
      or new.mode not in ('partner', 'friend')
      or jsonb_typeof(new.players) is distinct from 'array'
      or jsonb_array_length(new.players) is distinct from 2
      or new.players #>> '{0,uid}' is distinct from new.player1_uid::text
      or new.players #>> '{1,uid}' is distinct from new.player2_uid::text
      or jsonb_array_length(new.players #> '{0,rack}') is distinct from 7
      or jsonb_array_length(new.players #> '{1,rack}') is distinct from 7
      or coalesce((new.players #>> '{0,score}')::integer, -1) <> 0
      or coalesce((new.players #>> '{1,score}')::integer, -1) <> 0
      or new.players #>> '{0,historyVersion}' is distinct from '2'
      or new.players #>> '{1,historyVersion}' is distinct from '2'
      or jsonb_array_length(new.bag) is distinct from 90
      or jsonb_typeof(new.board) is distinct from 'array'
      or jsonb_array_length(new.board) is distinct from 15
      or exists (
        select 1
        from jsonb_array_elements(new.board) as board_rows(row_value)
        cross join lateral jsonb_array_elements(board_rows.row_value) as board_cells(cell_value)
        where board_cells.cell_value -> 'tile' is distinct from 'null'::jsonb
      )
    then
      raise exception 'Invalid active game shape';
    end if;
    return new;
  end if;

  if
    new.player1_uid is distinct from old.player1_uid
    or new.player2_uid is distinct from old.player2_uid
    or new.rematch_of is distinct from old.rematch_of
    or new.players #>> '{0,uid}' is distinct from old.players #>> '{0,uid}'
    or new.players #>> '{1,uid}' is distinct from old.players #>> '{1,uid}'
    or new.players #>> '{0,displayName}' is distinct from old.players #>> '{0,displayName}'
    or new.players #>> '{1,displayName}' is distinct from old.players #>> '{1,displayName}'
    or new.players #>> '{0,email}' is distinct from old.players #>> '{0,email}'
    or new.players #>> '{1,email}' is distinct from old.players #>> '{1,email}'
  then
    raise exception 'Game player identities are immutable';
  end if;

  if old.status = 'declined' then
    raise exception 'Declined invitations cannot be changed';
  end if;
  if old.status = 'active' and new.status not in ('active', 'finished') then
    raise exception 'Active games may only remain active or finish';
  end if;
  if old.status = 'finished' and new.status is distinct from old.status then
    raise exception 'Terminal game statuses cannot be changed';
  end if;

  if old.status = 'waiting' then
    if new.status = 'active' then
      if auth.uid() is null or auth.uid() <> old.player2_uid then
        raise exception 'Only the invited player can accept an invitation';
      end if;
      if
        new.current_turn is distinct from old.player1_uid
        or jsonb_array_length(new.players #> '{0,rack}') is distinct from 7
        or jsonb_array_length(new.players #> '{1,rack}') is distinct from 7
        or jsonb_array_length(new.bag) is distinct from 90
        or new.moves is distinct from '[]'::jsonb
        or coalesce((new.players #>> '{0,score}')::integer, -1) <> 0
        or coalesce((new.players #>> '{1,score}')::integer, -1) <> 0
        or new.players #>> '{0,historyVersion}' is distinct from '2'
        or new.players #>> '{1,historyVersion}' is distinct from '2'
        or jsonb_typeof(new.board) is distinct from 'array'
        or jsonb_array_length(new.board) is distinct from 15
        or exists (
          select 1
          from jsonb_array_elements(new.board) as board_rows(row_value)
          cross join lateral jsonb_array_elements(board_rows.row_value) as board_cells(cell_value)
          where board_cells.cell_value -> 'tile' is distinct from 'null'::jsonb
        )
      then
        raise exception 'Invalid accepted invitation shape';
      end if;
    elsif new.status = 'declined' then
      if auth.uid() is null or auth.uid() not in (old.player1_uid, old.player2_uid) then
        raise exception 'Only invitation participants can decline or cancel';
      end if;
      new.updated_at := clock_timestamp();
      if
        to_jsonb(new) - 'status' - 'updated_at'
        is distinct from
        to_jsonb(old) - 'status' - 'updated_at'
      then
        raise exception 'Decline or cancel may only change invitation status';
      end if;
    else
      raise exception 'Invalid invitation transition';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_game_invitation_rules_trigger on games;
create trigger enforce_game_invitation_rules_trigger
  before insert or update on games
  for each row execute function public.enforce_game_invitation_rules();

create or replace function public.cleanup_player_discovery_bookkeeping()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Keep dedupe tombstones while their source event could still authorize a
  -- notification. Removing those rows by age alone would make old events replayable.
  delete from public.notification_delivery_events delivery
  where delivery.delivered_at < clock_timestamp() - interval '7 days'
    and not exists (
      select 1
      from public.games game
      where (
        delivery.notification_type = 'invite'
        and game.status = 'waiting'
        and game.player1_uid = delivery.sender_uid
        and game.player2_uid = delivery.recipient_uid
        and delivery.event_key = 'invite:' || game.id::text
      ) or (
        delivery.notification_type = 'turn'
        and game.status = 'active'
        and game.current_turn = delivery.recipient_uid
        and delivery.event_key =
          'turn:' || game.id::text || ':' || (jsonb_array_length(game.moves) - 1)::text
        and game.moves -> (jsonb_array_length(game.moves) - 1) ->> 'uid' =
          delivery.sender_uid::text
        and (
          (game.player1_uid = delivery.sender_uid
            and game.player2_uid = delivery.recipient_uid)
          or
          (game.player2_uid = delivery.sender_uid
            and game.player1_uid = delivery.recipient_uid)
        )
      ) or (
        delivery.notification_type = 'lovenote'
        and game.status = 'active'
        and exists (
          select 1
          from public.love_notes note
          where note.game_id = game.id
            and note.from_uid = delivery.sender_uid
            and note.to_uid = delivery.recipient_uid
            and delivery.event_key = 'lovenote:' || note.id::text
        )
      )
    );

  delete from public.notification_rate_limits
  where last_delivered_at < clock_timestamp() - interval '2 days';

  delete from public.profile_email_lookup_limits
  where window_started < clock_timestamp() - interval '2 days';

  delete from public.game_creation_grants
  where expires_at < clock_timestamp();

  delete from public.games
  where status = 'declined'
    and updated_at < clock_timestamp() - interval '30 days';
end;
$$;

-- Schedule the daily bookkeeping cleanup, best-effort. pg_cron requires
-- superuser to install, so on Supabase it must be enabled from the dashboard
-- (Database > Extensions). When it is unavailable the rest of this schema still
-- applies; enable pg_cron and re-run (or schedule
-- public.cleanup_player_discovery_bookkeeping() by hand) to activate the sweep.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%); skipping cleanup schedule. Enable pg_cron from the Supabase dashboard and re-run to schedule public.cleanup_player_discovery_bookkeeping().', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'lovewords-player-discovery-cleanup',
      '17 3 * * *',
      'select public.cleanup_player_discovery_bookkeeping()'
    );
  end if;
end;
$$;

revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.find_profile_by_email(text) from public, anon;
drop function if exists public.create_active_game(jsonb, jsonb, jsonb, uuid, text, text, uuid, boolean);
revoke all on function public.create_active_game(jsonb, jsonb, jsonb, uuid, text, boolean, uuid, boolean)
  from public, anon;
revoke execute on function public.enforce_game_invitation_rules() from public, anon, authenticated;
revoke execute on function public.cleanup_player_discovery_bookkeeping()
  from public, anon, authenticated;
drop function if exists public.claim_notification_delivery(uuid, uuid, uuid, text);
revoke execute on function public.claim_notification_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.find_profile_by_email(text) to authenticated;
grant execute on function public.create_active_game(jsonb, jsonb, jsonb, uuid, text, boolean, uuid, boolean)
  to authenticated;
grant execute on function public.claim_notification_delivery(uuid, uuid, text, text)
  to service_role;

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

-- ============================================================
-- Email / code invites for people not yet on the app
-- ============================================================
-- See supabase/migrations/20260731000100_email_invites.sql for the full
-- rationale. Inviting an existing member still uses the discovery / exact-email
-- flow; this covers inviting an email that belongs to nobody yet. Redemption
-- issues a game_creation_grant so the game is opened through the same
-- server-owned create_active_game contract as every other real game.

create table if not exists public.email_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  inviter_uid uuid not null references auth.users(id) on delete cascade,
  invitee_email text,
  invitee_phone text,
  mode text not null default 'partner' check (mode in ('partner', 'friend')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  redeemer_uid uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  constraint email_invites_contact_present
    check (invitee_email is not null or invitee_phone is not null)
);
alter table public.email_invites add column if not exists invitee_phone text;
alter table public.email_invites alter column invitee_email drop not null;

create index if not exists email_invites_inviter_pending_idx
  on public.email_invites (inviter_uid, created_at)
  where status = 'pending';
create index if not exists email_invites_inviter_email_pending_idx
  on public.email_invites (inviter_uid, lower(invitee_email))
  where status = 'pending';
create index if not exists email_invites_inviter_phone_pending_idx
  on public.email_invites (inviter_uid, invitee_phone)
  where status = 'pending';

alter table public.email_invites enable row level security;
revoke all on table public.email_invites from public, anon, authenticated;
grant select on table public.email_invites to authenticated;
grant all on table public.email_invites to service_role;

drop policy if exists "email_invites_owner_read" on public.email_invites;
create policy "email_invites_owner_read" on public.email_invites
  for select using (auth.uid() = inviter_uid);

create table if not exists public.email_invite_claim_limits (
  redeemer_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.email_invite_claim_limits enable row level security;
revoke all on table public.email_invite_claim_limits from public, anon, authenticated;
grant all on table public.email_invite_claim_limits to service_role;

create or replace function public.create_email_invite(
  invitee_email text,
  invite_mode text default 'partner'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  normalized_email text := lower(trim(invitee_email));
  normalized_mode text := coalesce(nullif(trim(invite_mode), ''), 'partner');
  code_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  existing_code text;
  new_code text;
  attempt integer;
  char_index integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if normalized_email is null or char_length(normalized_email) < 3
    or position('@' in normalized_email) < 2
  then
    raise exception 'Enter a valid email address';
  end if;
  if normalized_mode not in ('partner', 'friend') then
    raise exception 'Invalid game mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email-invite:' || caller_id::text, 0));

  if (
    select count(*) from public.email_invites e
    where e.inviter_uid = caller_id
      and e.status = 'pending'
      and e.created_at >= clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many invitations; try again later';
  end if;

  update public.email_invites
  set expires_at = clock_timestamp() + interval '14 days'
  where inviter_uid = caller_id
    and lower(invitee_email) = normalized_email
    and status = 'pending'
    and expires_at > clock_timestamp()
  returning code into existing_code;
  if existing_code is not null then
    return existing_code;
  end if;

  for attempt in 1..12 loop
    new_code := '';
    for char_index in 1..8 loop
      new_code := new_code
        || substr(code_alphabet, 1 + floor(random() * length(code_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.email_invites e where e.code = new_code);
    new_code := null;
  end loop;
  if new_code is null then
    raise exception 'Could not allocate an invite code; try again';
  end if;

  insert into public.email_invites (code, inviter_uid, invitee_email, mode)
  values (new_code, caller_id, normalized_email, normalized_mode);

  return new_code;
end;
$$;

create or replace function public.create_phone_invite(
  invitee_phone text,
  invite_mode text default 'partner'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  cleaned_phone text := regexp_replace(coalesce(invitee_phone, ''), '[^0-9+]', '', 'g');
  digit_count integer := char_length(regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g'));
  normalized_mode text := coalesce(nullif(trim(invite_mode), ''), 'partner');
  code_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  existing_code text;
  new_code text;
  attempt integer;
  char_index integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if digit_count < 7 or digit_count > 15 then
    raise exception 'Enter a valid phone number';
  end if;
  if normalized_mode not in ('partner', 'friend') then
    raise exception 'Invalid game mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email-invite:' || caller_id::text, 0));

  if (
    select count(*) from public.email_invites e
    where e.inviter_uid = caller_id
      and e.status = 'pending'
      and e.created_at >= clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many invitations; try again later';
  end if;

  update public.email_invites
  set expires_at = clock_timestamp() + interval '14 days'
  where inviter_uid = caller_id
    and invitee_phone = cleaned_phone
    and status = 'pending'
    and expires_at > clock_timestamp()
  returning code into existing_code;
  if existing_code is not null then
    return existing_code;
  end if;

  for attempt in 1..12 loop
    new_code := '';
    for char_index in 1..8 loop
      new_code := new_code
        || substr(code_alphabet, 1 + floor(random() * length(code_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.email_invites e where e.code = new_code);
    new_code := null;
  end loop;
  if new_code is null then
    raise exception 'Could not allocate an invite code; try again';
  end if;

  insert into public.email_invites (code, inviter_uid, invitee_phone, mode)
  values (new_code, caller_id, cleaned_phone, normalized_mode);

  return new_code;
end;
$$;

create or replace function public.redeem_email_invite(invite_code text)
returns table (inviter_uid uuid, inviter_display_name text, mode text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  redeemer_id uuid := auth.uid();
  normalized_code text := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  claim_attempts integer;
  invite public.email_invites%rowtype;
  inviter_name text;
begin
  if redeemer_id is null then
    raise exception 'Authentication required';
  end if;
  if char_length(normalized_code) <> 8 then
    raise exception 'Invite is no longer available';
  end if;

  insert into public.email_invite_claim_limits (redeemer_id, window_started, attempts)
  values (redeemer_id, clock_timestamp(), 1)
  on conflict (redeemer_id) do update
  set
    window_started = case
      when email_invite_claim_limits.window_started < clock_timestamp() - interval '1 hour'
        then clock_timestamp()
      else email_invite_claim_limits.window_started
    end,
    attempts = case
      when email_invite_claim_limits.window_started < clock_timestamp() - interval '1 hour'
        then 1
      else email_invite_claim_limits.attempts + 1
    end
  returning attempts into claim_attempts;
  if claim_attempts > 20 then
    raise exception 'Too many attempts; try again later';
  end if;

  select * into invite
  from public.email_invites e
  where e.code = normalized_code
    and e.status = 'pending'
    and e.expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'Invite is no longer available';
  end if;
  if invite.inviter_uid = redeemer_id then
    raise exception 'You cannot redeem your own invite';
  end if;

  select p.display_name into inviter_name
  from public.profiles p where p.id = invite.inviter_uid;
  if inviter_name is null then
    raise exception 'Invite is no longer available';
  end if;

  update public.email_invites
  set status = 'accepted', redeemer_uid = redeemer_id
  where id = invite.id;

  insert into public.game_creation_grants (creator_uid, opponent_uid, expires_at)
  values (redeemer_id, invite.inviter_uid, clock_timestamp() + interval '5 minutes')
  on conflict (creator_uid, opponent_uid) do update
  set expires_at = excluded.expires_at;

  return query select invite.inviter_uid, inviter_name, invite.mode;
end;
$$;

create or replace function public.cleanup_email_invites()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.email_invites
  where (status <> 'pending' or expires_at < clock_timestamp())
    and created_at < clock_timestamp() - interval '30 days';
  delete from public.email_invite_claim_limits
  where window_started < clock_timestamp() - interval '2 days';
end;
$$;

revoke all on function public.create_email_invite(text, text) from public, anon;
revoke all on function public.create_phone_invite(text, text) from public, anon;
revoke all on function public.redeem_email_invite(text) from public, anon;
revoke execute on function public.cleanup_email_invites() from public, anon, authenticated;
grant execute on function public.create_email_invite(text, text) to authenticated;
grant execute on function public.create_phone_invite(text, text) to authenticated;
grant execute on function public.redeem_email_invite(text) to authenticated;
