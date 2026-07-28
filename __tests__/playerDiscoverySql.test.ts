import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260728000100_player_discovery_invites.sql'
);
const schemaPath = path.join(process.cwd(), 'supabase_schema.sql');

describe.each([
  ['standalone migration', migrationPath],
  ['reference schema', schemaPath],
])('%s player discovery contract', (_label, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8').toLowerCase();

  test('defines opt-in discovery and an index idempotently', () => {
    expect(sql).toContain('add column if not exists discoverable boolean not null default false');
    expect(sql).toContain('create index if not exists profiles_discoverable_display_name_prefix_idx');
  });

  test('removes broad reads and limits owner writes', () => {
    expect(sql).toContain('drop policy if exists "profiles_read"');
    expect(sql).toContain('create policy "profiles_owner_read"');
    expect(sql).toContain('with check (auth.uid() = id)');
  });

  test('installs hardened discovery and exact-email functions', () => {
    expect(sql).toContain('function public.search_profiles(search_query text)');
    expect(sql).toContain('function public.find_profile_by_email(lookup_email text)');
    expect(sql).toContain('returns table (id uuid, display_name text)');
    expect(sql).not.toContain('returns table (id uuid, display_name text, email text)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('limit 20');
    expect(sql).toContain("char_length(normalized_query) < 3");
    expect(sql).toContain('revoke all on function public.search_profiles(text) from public, anon');
    expect(sql).toContain('grant execute on function public.search_profiles(text) to authenticated');
  });

  test('binds exact email to auth identity and throttles lookups in private state', () => {
    expect(sql).toContain('create table if not exists');
    expect(sql).toContain('profile_email_lookup_limits');
    expect(sql).toContain('revoke all on table public.profile_email_lookup_limits');
    expect(sql).toContain('join public.profiles p on p.id = u.id');
    expect(sql).toContain('where lower(u.email) = lower(trim(lookup_email))');
    expect(sql).not.toContain('where lower(p.email) = lower(trim(lookup_email))');
    expect(sql).toContain('if lookup_attempts > 20');
  });

  test('enforces invitation shape, authorization, duplicate prevention, and rate limits', () => {
    expect(sql).toContain('function public.enforce_game_invitation_rules()');
    expect(sql).toContain('only the invited player can accept an invitation');
    expect(sql).toContain('game player identities are immutable');
    expect(sql).toContain('invalid waiting invitation shape');
    expect(sql).toContain('a pending invitation already exists between these players');
    expect(sql).toContain('too many invitations; try again later');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('before insert or update');
  });

  test('preserves the non-authoritative RevenueCat support mirror', () => {
    expect(sql).toContain('add column if not exists has_paid boolean not null default false');
    expect(sql).toContain(
      'grant update (discoverable, expo_push_token, has_paid) on table'
    );
  });

  test('creates active games through an explicit server-owned contract', () => {
    expect(sql).toContain('function public.create_active_game(');
    expect(sql).toContain('choose exactly one game creation reason');
    expect(sql).toContain('game_creation_grants');
    expect(sql).toContain(
      'revoke all on table public.game_creation_grants from public, anon, authenticated'
    );
    expect(sql).toContain('email lookup grant does not authorize these participants');
    expect(sql).toContain("clock_timestamp() + interval '5 minutes'");
    expect(sql).toContain("source_game.status <> 'finished'");
    expect(sql).toContain('source game does not authorize this rematch');
    expect(sql).toContain('games_one_rematch_per_source_idx');
    expect(sql).toContain("'email', ''");
    expect(sql).toContain(
      "current_setting('app.active_game_creation', true) is distinct from 'authorized'"
    );
    expect(sql).toContain('active games must be created through create_active_game');
    expect(sql).toContain("if new.status is distinct from 'active'");
    expect(sql).toContain('invalid active game shape');
  });

  test('routes a concurrent rematch of the same finished game to the existing one', () => {
    // Both players can tap Rematch at once; the unique index allows one rematch
    // per source, so the losing race must return the existing rematch rather
    // than raise a duplicate-key error to the client.
    expect(sql).toContain('exception when unique_violation then');
    expect(sql).toContain('where rematch_of = source_game_id');
  });

  test('uses null-safe waiting checks and serializes each sender rate bucket', () => {
    expect(sql).toContain("'invite-sender:' || new.player1_uid::text");
    expect(sql).toContain("new.players #>> '{0,email}' is distinct from ''");
    expect(sql).toContain("new.players #>> '{1,email}' is distinct from ''");
    expect(sql).not.toContain("new.players #>> '{0,email}' <> ''");
  });

  test('deduplicates notification events and rate-limits sender/recipient pairs globally', () => {
    expect(sql).toContain('notification_rate_limits');
    expect(sql).toContain('notification_delivery_events');
    expect(sql).toContain(
      'revoke all on table public.notification_rate_limits from public, anon, authenticated'
    );
    expect(sql).toContain(
      'primary key (sender_uid, recipient_uid, notification_type, event_key)'
    );
    expect(sql).toContain('function public.claim_notification_delivery(');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).not.toContain('claim_game_id');
    expect(sql).toContain("when 'nudge' then interval '1 hour'");
    expect(sql).toContain(
      'grant execute on function public.claim_notification_delivery(uuid, uuid, text, text)'
    );
    expect(sql).toContain('to service_role');
    expect(sql).toContain('grant update ("read") on table');
  });

  test('schedules bounded retention for private bookkeeping and declined invitations', () => {
    expect(sql).toContain('create extension if not exists pg_cron');
    expect(sql).toContain('function public.cleanup_player_discovery_bookkeeping()');
    expect(sql).toContain("delivered_at < clock_timestamp() - interval '7 days'");
    expect(sql).toContain("last_delivered_at < clock_timestamp() - interval '2 days'");
    expect(sql).toContain("window_started < clock_timestamp() - interval '2 days'");
    expect(sql).toContain('where expires_at < clock_timestamp()');
    expect(sql).toContain("where status = 'declined'");
    expect(sql).toContain("updated_at < clock_timestamp() - interval '30 days'");
    expect(sql).toContain("'lovewords-player-discovery-cleanup'");
    expect(sql).toContain(
      'revoke execute on function public.cleanup_player_discovery_bookkeeping()'
    );
    expect(sql).toContain('and not exists (');
    expect(sql).toContain("delivery.event_key = 'invite:' || game.id::text");
    expect(sql).toContain("'turn:' || game.id::text || ':'");
    expect(sql).toContain("delivery.event_key = 'lovenote:' || note.id::text");
  });

  test('server-stamps declined invitation retention time', () => {
    expect(sql).toContain("elsif new.status = 'declined' then");
    expect(sql).toContain('new.updated_at := clock_timestamp()');
    expect(sql).toContain(
      "if old.status = 'active' and new.status not in ('active', 'finished')"
    );
    expect(sql).toContain("if old.status = 'declined' then");
    expect(sql).toContain('declined invitations cannot be changed');
    expect(sql).toContain(
      "if old.status = 'finished' and new.status is distinct from old.status"
    );
  });
});
