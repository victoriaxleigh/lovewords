import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260731000100_email_invites.sql'
);
const schemaPath = path.join(process.cwd(), 'supabase_schema.sql');

describe.each([
  ['standalone migration', migrationPath],
  ['reference schema', schemaPath],
])('%s email invite contract', (_label, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8').toLowerCase();

  test('defines a locked-down email_invites table with owner-only reads', () => {
    expect(sql).toContain('create table if not exists public.email_invites');
    expect(sql).toContain("status text not null default 'pending'");
    expect(sql).toContain("check (status in ('pending', 'accepted', 'revoked'))");
    expect(sql).toContain(
      'revoke all on table public.email_invites from public, anon, authenticated'
    );
    expect(sql).toContain('grant select on table public.email_invites to authenticated');
    expect(sql).toContain('create policy "email_invites_owner_read"');
    expect(sql).toContain('using (auth.uid() = inviter_uid)');
  });

  test('supports either an email or a phone contact', () => {
    expect(sql).toContain('invitee_phone text');
    // Email is nullable so a phone-only invite is valid, but at least one of the
    // two contacts must be present.
    expect(sql).toContain(
      'check (invitee_email is not null or invitee_phone is not null)'
    );
    expect(sql).toContain('function public.create_phone_invite(');
    expect(sql).toContain('enter a valid phone number');
    expect(sql).toContain('grant execute on function public.create_phone_invite(text, text) to authenticated');
    expect(sql).toContain('revoke all on function public.create_phone_invite(text, text) from public, anon');
  });

  test('mints codes through a hardened, rate-limited definer function', () => {
    expect(sql).toContain('function public.create_email_invite(');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('too many invitations; try again later');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('revoke all on function public.create_email_invite(text, text) from public, anon');
    expect(sql).toContain('grant execute on function public.create_email_invite(text, text) to authenticated');
  });

  test('redeems atomically into the shared active-game contract', () => {
    expect(sql).toContain('function public.redeem_email_invite(');
    // The game is created inside redemption (one transaction), not a second RPC.
    expect(sql).toContain('created_game_id := public.create_active_game(');
    // Redemption must not forge a game row; it authorizes create_active_game.
    expect(sql).toContain('insert into public.game_creation_grants (creator_uid, opponent_uid, expires_at)');
    expect(sql).toContain("clock_timestamp() + interval '5 minutes'");
    // Idempotent replay returns the game created the first time, not a duplicate.
    expect(sql).toContain('return invite.game_id');
    expect(sql).toContain('grant execute on function public.redeem_email_invite(text, jsonb, jsonb, jsonb, jsonb) to authenticated');
  });

  test('records redemption attempts durably (returns, never raises, on failure)', () => {
    expect(sql).toContain('create table if not exists public.email_invite_claim_limits');
    expect(sql).toContain(
      'revoke all on table public.email_invite_claim_limits from public, anon, authenticated'
    );
    expect(sql).toContain('if claim_attempts > 20');
    // The over-limit and not-found paths must RETURN, not RAISE, or the attempt
    // increment is rolled back and the throttle never counts invalid guesses.
    expect(sql).toContain('return null');
    expect(sql).not.toMatch(/raise exception 'invite is no longer available'/i);
  });

  test('generates codes with a CSPRNG (gen_random_uuid), not random()', () => {
    expect(sql).toContain('function public._generate_invite_code()');
    // Strong RNG source that does not depend on pgcrypto being on search_path.
    expect(sql).toContain('gen_random_uuid()');
    expect(sql).toContain("get_byte(decode(substr(hex, pos, 2), 'hex'), 0)");
    expect(sql).toContain('if sample < 248'); // rejection sampling removes modulo bias
    expect(sql).not.toContain('floor(random()');
    expect(sql).not.toContain('gen_random_bytes');
  });

  test('rate-limits invite email delivery atomically', () => {
    expect(sql).toContain('function public.claim_invite_email_delivery(');
    expect(sql).toContain("interval '60 seconds'"); // cooldown
    expect(sql).toContain('invite.emails_sent >= 5'); // hard cap
    expect(sql).toContain('or invite.expires_at <= clock_timestamp()'); // expiry gate
    expect(sql).toContain(
      'grant execute on function public.claim_invite_email_delivery(text, uuid) to service_role'
    );
  });

  test('exact-email lookup raises on throttle so misses are distinguishable', () => {
    expect(sql).toContain('function public.find_profile_by_email(lookup_email text)');
    expect(sql).toContain("raise exception 'too many lookups; try again later'");
  });

  test('bounds retention for accepted and expired invites', () => {
    expect(sql).toContain('function public.cleanup_email_invites()');
    expect(sql).toContain("created_at < clock_timestamp() - interval '30 days'");
    expect(sql).toContain(
      'revoke execute on function public.cleanup_email_invites() from public, anon, authenticated'
    );
  });
});
