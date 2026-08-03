-- ============================================================
-- LoveWords — Email / code invites for people not yet on the app
-- ============================================================
-- Lets a signed-in player invite someone by email address or phone number
-- even when that person does not have an account yet. Inviting an *existing*
-- member still goes through the discovery / exact-email flow; this covers the
-- gap where the contact belongs to nobody yet. (The table is named
-- email_invites for history; it holds both email and phone invites — the code
-- and link are the same either way, only the delivery channel differs.)
--
-- Flow:
--   1. Inviter calls create_email_invite / create_phone_invite -> a short
--      single-use code. The client turns that into a shareable link and (for
--      email) may ask the send-invite Netlify function to email it.
--   2. The invitee opens the link (?invite=CODE) or types the code, signs up,
--      and the client calls redeem_email_invite(code, board, bag, racks).
--   3. redeem_email_invite creates the active game AND marks the invite
--      accepted in a single transaction (atomic), through the same
--      server-owned create_active_game contract every other game uses — no
--      bespoke tile dealing in SQL, no new way to forge a game row, and no
--      window where the invite is spent but the game does not exist.

begin;

-- gen_random_bytes (CSPRNG) for authorization-bearing invite codes.
create extension if not exists pgcrypto;

create table if not exists public.email_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  inviter_uid uuid not null references auth.users(id) on delete cascade,
  invitee_email text,
  invitee_phone text,
  mode text not null default 'partner' check (mode in ('partner', 'friend')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  redeemer_uid uuid references auth.users(id) on delete set null,
  game_id uuid references public.games(id) on delete set null,
  emails_sent integer not null default 0 check (emails_sent >= 0),
  last_email_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  constraint email_invites_contact_present
    check (invitee_email is not null or invitee_phone is not null)
);
-- Columns added after the first cut of this migration; keep older installs idempotent.
alter table public.email_invites add column if not exists invitee_phone text;
alter table public.email_invites add column if not exists game_id uuid references public.games(id) on delete set null;
alter table public.email_invites add column if not exists emails_sent integer not null default 0;
alter table public.email_invites add column if not exists last_email_at timestamptz;
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
-- Inviters may read their own invites (to show status / re-share the code).
-- Every write goes through the security-definer functions below, so no direct
-- insert/update/delete is granted to clients.
grant select on table public.email_invites to authenticated;
grant all on table public.email_invites to service_role;

drop policy if exists "email_invites_owner_read" on public.email_invites;
create policy "email_invites_owner_read" on public.email_invites
  for select using (auth.uid() = inviter_uid);

-- Per-account throttle for redemption attempts. A wrong code never consumes an
-- invite, so without this a caller could brute-force codes; the limiter caps
-- how many guesses an authenticated account may make per hour. Crucially, the
-- redemption function RETURNS (never RAISEs) on an expected failure, so the
-- increment recorded here is committed even for an invalid attempt.
create table if not exists public.email_invite_claim_limits (
  redeemer_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.email_invite_claim_limits enable row level security;
revoke all on table public.email_invite_claim_limits from public, anon, authenticated;
grant all on table public.email_invite_claim_limits to service_role;

-- ── Invite code generator (CSPRNG) ──────────────────────────────────────────
-- 8 characters from a 31-symbol, ambiguity-free alphabet. gen_random_bytes is
-- a CSPRNG; rejection sampling (bytes >= 248 discarded) removes modulo bias so
-- every symbol is equally likely. Not client-callable.
create or replace function public._generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  code_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  new_code text;
  attempt integer;
  char_index integer;
  sample integer;
begin
  for attempt in 1..16 loop
    new_code := '';
    for char_index in 1..8 loop
      loop
        sample := get_byte(gen_random_bytes(1), 0);
        exit when sample < 248; -- 31 * 8, the largest unbiased multiple
      end loop;
      new_code := new_code || substr(code_alphabet, 1 + (sample % 31), 1);
    end loop;
    exit when not exists (select 1 from public.email_invites e where e.code = new_code);
    new_code := null;
  end loop;
  if new_code is null then
    raise exception 'Could not allocate an invite code; try again';
  end if;
  return new_code;
end;
$$;

-- ── create_email_invite ─────────────────────────────────────────────────────
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
  existing_code text;
  new_code text;
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

  -- Serialize each inviter so the rate check and the dedupe/insert below cannot
  -- race with a second tab creating a duplicate invite for the same person.
  perform pg_advisory_xact_lock(hashtextextended('email-invite:' || caller_id::text, 0));

  if (
    select count(*) from public.email_invites e
    where e.inviter_uid = caller_id
      and e.status = 'pending'
      and e.created_at >= clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many invitations; try again later';
  end if;

  -- Idempotent per (inviter, email): re-sharing the same person hands back the
  -- existing pending code and refreshes its expiry rather than piling up codes.
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

  new_code := public._generate_invite_code();
  insert into public.email_invites (code, inviter_uid, invitee_email, mode)
  values (new_code, caller_id, normalized_email, normalized_mode);

  return new_code;
end;
$$;

-- ── create_phone_invite ─────────────────────────────────────────────────────
-- Same single-use code, minted for a phone number instead of an email. The app
-- never sends the text itself — the inviter shares it from their Messages app —
-- so there is no delivery side to this; it only allocates the code/link.
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
  existing_code text;
  new_code text;
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

  -- Share the per-inviter lock/rate bucket with email invites so the combined
  -- pending cap can't be raced across both channels.
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

  new_code := public._generate_invite_code();
  insert into public.email_invites (code, inviter_uid, invitee_phone, mode)
  values (new_code, caller_id, cleaned_phone, normalized_mode);

  return new_code;
end;
$$;

-- ── redeem_email_invite (atomic) ────────────────────────────────────────────
-- Redeems a code as the signed-in user and creates the active game with the
-- inviter in ONE transaction. Returns the new game id, or NULL when the invite
-- is unavailable. It never RAISEs for an expected failure (bad/expired/taken
-- code, throttled attempt) — that would roll back the throttle increment above
-- and defeat the brute-force limiter. The client generates the tiles (board /
-- bag / two racks) and passes them, exactly as createGame does; this function
-- assembles the players from the trusted redeemer + inviter identities.
drop function if exists public.redeem_email_invite(text);
create or replace function public.redeem_email_invite(
  invite_code text,
  game_board jsonb,
  game_bag jsonb,
  rack1 jsonb,
  rack2 jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  redeemer_id uuid := auth.uid();
  normalized_code text := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  claim_attempts integer;
  invite public.email_invites%rowtype;
  game_players jsonb;
  created_game_id uuid;
begin
  if redeemer_id is null then
    raise exception 'Authentication required';
  end if;

  -- Record the attempt FIRST, then only RETURN (never RAISE) on expected
  -- failures below, so the increment survives even an invalid guess.
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
    return null;
  end if;

  if char_length(normalized_code) <> 8 then
    return null;
  end if;

  select * into invite
  from public.email_invites e
  where e.code = normalized_code
  for update;
  if not found then
    return null;
  end if;

  -- Idempotent replay: the same redeemer re-running an already-accepted invite
  -- gets the game created the first time, never a duplicate.
  if invite.status = 'accepted' then
    if invite.redeemer_uid = redeemer_id and invite.game_id is not null then
      return invite.game_id;
    end if;
    return null;
  end if;

  if invite.status <> 'pending' or invite.expires_at <= clock_timestamp() then
    return null;
  end if;
  if invite.inviter_uid = redeemer_id then
    return null;
  end if;
  if not exists (select 1 from public.profiles p where p.id = invite.inviter_uid) then
    return null;
  end if;

  -- Authorize + create the game in this same transaction. If create_active_game
  -- rejects the tiles, everything rolls back and the invite stays pending and
  -- retryable — the invite is only marked accepted once the game truly exists.
  insert into public.game_creation_grants (creator_uid, opponent_uid, expires_at)
  values (redeemer_id, invite.inviter_uid, clock_timestamp() + interval '5 minutes')
  on conflict (creator_uid, opponent_uid) do update
  set expires_at = excluded.expires_at;

  game_players := jsonb_build_array(
    jsonb_build_object(
      'uid', redeemer_id, 'rack', coalesce(rack1, '[]'::jsonb),
      'score', 0, 'historyVersion', 2
    ),
    jsonb_build_object(
      'uid', invite.inviter_uid, 'rack', coalesce(rack2, '[]'::jsonb),
      'score', 0, 'historyVersion', 2
    )
  );

  created_game_id := public.create_active_game(
    game_players,
    game_board,
    game_bag,
    redeemer_id,
    invite.mode,
    true,   -- email_grant
    null,   -- source_game_id
    false   -- solo_game
  );

  update public.email_invites
  set status = 'accepted', redeemer_uid = redeemer_id, game_id = created_game_id
  where id = invite.id;

  return created_game_id;
end;
$$;

-- ── claim_invite_email_delivery ─────────────────────────────────────────────
-- Atomic gate the send-invite function calls before emailing: verifies the
-- caller owns a pending, unexpired invite and enforces a 60-second cooldown
-- plus a hard cap of 5 emails per invite, so a pending invite can't be used to
-- spam the recipient or burn the email provider's quota. Service-role only.
create or replace function public.claim_invite_email_delivery(
  invite_code text,
  sender_uid uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_code text := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  invite public.email_invites%rowtype;
begin
  if char_length(normalized_code) <> 8 then
    return false;
  end if;
  select * into invite
  from public.email_invites e
  where e.code = normalized_code
  for update;
  if not found
    or invite.inviter_uid <> sender_uid
    or invite.status <> 'pending'
    or invite.expires_at <= clock_timestamp()
    or invite.invitee_email is null
  then
    return false;
  end if;
  if invite.last_email_at is not null
    and invite.last_email_at > clock_timestamp() - interval '60 seconds'
  then
    return false;
  end if;
  if invite.emails_sent >= 5 then
    return false;
  end if;

  update public.email_invites
  set emails_sent = emails_sent + 1, last_email_at = clock_timestamp()
  where id = invite.id;
  return true;
end;
$$;

-- ── Exact-email lookup: surface throttling instead of a silent empty result ──
-- A signed-in caller's own per-account lookup allowance being exhausted is not
-- a discovery signal about anyone else, so raising is safe — and it stops the
-- New Game flow from mistaking a throttled lookup for "this email has no
-- account" and creating an onboarding invite for an existing member.
create or replace function public.find_profile_by_email(lookup_email text)
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
    raise exception 'Too many lookups; try again later';
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

-- ── Bounded retention ───────────────────────────────────────────────────────
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

revoke all on function public._generate_invite_code() from public, anon, authenticated;
revoke all on function public.create_email_invite(text, text) from public, anon;
revoke all on function public.create_phone_invite(text, text) from public, anon;
revoke all on function public.redeem_email_invite(text, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.claim_invite_email_delivery(text, uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_email_invites() from public, anon, authenticated;
grant execute on function public.create_email_invite(text, text) to authenticated;
grant execute on function public.create_phone_invite(text, text) to authenticated;
grant execute on function public.redeem_email_invite(text, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.claim_invite_email_delivery(text, uuid) to service_role;
-- find_profile_by_email keeps its existing grants from the discovery migration.
revoke all on function public.find_profile_by_email(text) from public, anon;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- Best-effort nightly sweep, same posture as the discovery bookkeeping cleanup:
-- pg_cron needs superuser to install, so on Supabase enable it from the
-- dashboard (Database > Extensions) and re-run this file to activate the sweep.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'lovewords-email-invite-cleanup',
      '37 3 * * *',
      'select public.cleanup_email_invites()'
    );
  end if;
end;
$$;

commit;
