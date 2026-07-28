begin;

alter table public.profiles
  add column if not exists discoverable boolean not null default false;
alter table public.profiles
  add column if not exists has_paid boolean not null default false;
alter table public.games
  add column if not exists rematch_of uuid references public.games(id) on delete set null;

create unique index if not exists games_one_rematch_per_source_idx
  on public.games (rematch_of)
  where rematch_of is not null;

create index if not exists profiles_discoverable_display_name_prefix_idx
  on public.profiles (lower(display_name) text_pattern_ops)
  where discoverable;

create table if not exists public.profile_email_lookup_limits (
  caller_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.profile_email_lookup_limits enable row level security;
revoke all on table public.profile_email_lookup_limits from public, anon, authenticated;
grant all on table public.profile_email_lookup_limits to service_role;

create table if not exists public.game_creation_grants (
  creator_uid uuid not null references auth.users(id) on delete cascade,
  opponent_uid uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (creator_uid, opponent_uid)
);

alter table public.game_creation_grants enable row level security;
revoke all on table public.game_creation_grants from public, anon, authenticated;
grant all on table public.game_creation_grants to service_role;

create table if not exists public.notification_rate_limits (
  sender_uid uuid not null references auth.users(id) on delete cascade,
  recipient_uid uuid not null references auth.users(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('invite', 'turn', 'lovenote', 'nudge')),
  window_started timestamptz not null default now(),
  last_delivered_at timestamptz not null default now(),
  deliveries integer not null default 1 check (deliveries > 0),
  primary key (sender_uid, recipient_uid, notification_type)
);

create table if not exists public.notification_delivery_events (
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

alter table public.profiles enable row level security;

drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_owner_read" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;

create policy "profiles_owner_read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on table public.profiles from public, anon, authenticated;
grant update (discoverable, expo_push_token, has_paid) on table public.profiles to authenticated;

-- A love-note ID is used as an immutable notification event. Recipients may
-- acknowledge a note, but cannot rewrite its sender, recipient, game, or body.
revoke update on table public.love_notes from public, anon, authenticated;
grant update ("read") on table public.love_notes to authenticated;

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
  current_time timestamptz := clock_timestamp();
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
      sender_uid,
      recipient_uid,
      notification_type,
      window_started,
      last_delivered_at,
      deliveries
    )
    values (
      claim_sender_uid,
      claim_recipient_uid,
      claim_notification_type,
      current_time,
      current_time,
      1
    );
  else
    if rate_state.last_delivered_at > current_time - cooldown then
      return false;
    end if;
    if rate_state.window_started <= current_time - interval '1 hour' then
      update public.notification_rate_limits
      set window_started = current_time, last_delivered_at = current_time, deliveries = 1
      where sender_uid = claim_sender_uid
        and recipient_uid = claim_recipient_uid
        and notification_type = claim_notification_type;
    elsif rate_state.deliveries >= hourly_limit then
      return false;
    else
      update public.notification_rate_limits
      set last_delivered_at = current_time, deliveries = deliveries + 1
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
      claim_sender_uid, claim_recipient_uid, claim_notification_type, claim_event_key, current_time
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

  -- Return the same empty result as an unknown email once the private
  -- per-account allowance is exhausted, so the throttle reveals no new signal.
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
    select * into source_game
    from public.games
    where id = source_game_id;
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
      jsonb_build_object(
        'uid', player1_id,
        'displayName', player1_name,
        'email', ''
      ),
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
      player1_uid,
      player2_uid,
      players,
      board,
      bag,
      current_turn,
      status,
      mode,
      moves,
      rematch_of
    )
    values (
      player1_id,
      player2_id,
      sanitized_players,
      game_board,
      game_bag,
      game_current_turn,
      'active',
      game_mode,
      '[]'::jsonb,
      source_game_id
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

drop index if exists public.games_outgoing_invite_rate_idx;
create index games_outgoing_invite_rate_idx
  on public.games (player1_uid, created_at)
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

drop trigger if exists enforce_game_invitation_rules_trigger on public.games;
create trigger enforce_game_invitation_rules_trigger
  before insert or update on public.games
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
-- (Database > Extensions). When it is unavailable the core discovery and
-- invitation migration still applies; enable pg_cron and re-run this file (or
-- schedule public.cleanup_player_discovery_bookkeeping() by hand) to activate
-- the nightly sweep.
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

commit;
