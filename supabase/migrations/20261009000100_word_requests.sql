-- Word requests: players ask for a rejected word to be added; the owner reviews.
--
-- word_requests holds one row per (word, player). It is backend-only, like
-- game_coach_notes: no client role gets a policy or any grant. The
-- word-requests Netlify function reads and writes it with the service-role key
-- and decides who may review (WORD_ADMIN_EMAILS).
--
-- added_words is the approved list. Every player's app reads it and merges it
-- into the dictionary, and the move solver does the same, so an approved word
-- counts everywhere. Only the service role writes it.
--
-- Forward-only and safe to rerun; it changes no existing table.

begin;

create table if not exists public.word_requests (
  id uuid primary key default gen_random_uuid(),
  word text not null check (word ~ '^[A-Z]{2,15}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (word, user_id)
);

-- The review list reads pending rows; the per-player cap counts them.
create index if not exists word_requests_pending_idx
  on public.word_requests (status, word);
create index if not exists word_requests_user_idx
  on public.word_requests (user_id, status);

alter table public.word_requests enable row level security;

revoke all on table public.word_requests from public, anon, authenticated;
grant select, insert, update on table public.word_requests to service_role;

create table if not exists public.added_words (
  word text primary key check (word ~ '^[A-Z]{2,15}$'),
  added_at timestamptz not null default now()
);

alter table public.added_words enable row level security;

drop policy if exists "added_words_read" on public.added_words;
create policy "added_words_read" on public.added_words
  for select to anon, authenticated using (true);

revoke all on table public.added_words from public, anon, authenticated;
grant select on table public.added_words to anon, authenticated;
grant select, insert, delete on table public.added_words to service_role;

commit;
