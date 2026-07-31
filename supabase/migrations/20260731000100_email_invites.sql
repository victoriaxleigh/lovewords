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
--   1. Inviter calls create_email_invite(email, mode) -> a short single-use
--      code. The client turns that into a shareable link and (optionally)
--      asks the send-invite Netlify function to email it.
--   2. The invitee opens the link (?invite=CODE) or types the code, signs up,
--      and the client calls redeem_email_invite(code).
--   3. redeem_email_invite issues a game_creation_grant authorizing the
--      redeemer to open an active game with the inviter, so the game is
--      created through the same server-owned create_active_game contract that
--      every other real game uses — no bespoke tile dealing in SQL, no new
--      way to forge a game row.

begin;

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
-- Phone support was added alongside email; keep older installs idempotent.
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
-- how many guesses an authenticated account may make per hour, mirroring the
-- private-state throttle used for exact-email lookups.
create table if not exists public.email_invite_claim_limits (
  redeemer_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.email_invite_claim_limits enable row level security;
revoke all on table public.email_invite_claim_limits from public, anon, authenticated;
grant all on table public.email_invite_claim_limits to service_role;

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

-- ── redeem_email_invite ─────────────────────────────────────────────────────
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

  -- Throttle guesses per account before touching any invite row.
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

  -- Authorize the redeemer to open exactly one active game with the inviter,
  -- through the same grant + create_active_game contract used by exact-email
  -- games. The redeemer becomes player one (created games start on player one).
  insert into public.game_creation_grants (creator_uid, opponent_uid, expires_at)
  values (redeemer_id, invite.inviter_uid, clock_timestamp() + interval '5 minutes')
  on conflict (creator_uid, opponent_uid) do update
  set expires_at = excluded.expires_at;

  return query select invite.inviter_uid, inviter_name, invite.mode;
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

revoke all on function public.create_email_invite(text, text) from public, anon;
revoke all on function public.create_phone_invite(text, text) from public, anon;
revoke all on function public.redeem_email_invite(text) from public, anon;
revoke execute on function public.cleanup_email_invites() from public, anon, authenticated;
grant execute on function public.create_email_invite(text, text) to authenticated;
grant execute on function public.create_phone_invite(text, text) to authenticated;
grant execute on function public.redeem_email_invite(text) to authenticated;

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
