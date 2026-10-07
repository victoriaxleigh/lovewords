-- Cached AI coach notes: one saved note per (finished game, asking player).
--
-- "Coach me again" used to re-run the whole model call every press. A saved note
-- is returned instead, so a finished game costs at most one model call per
-- player. The row count per user is also what the optional COACH_REVIEW_LIMIT
-- quota in netlify/functions/game-coach.js counts.
--
-- Backend-only, like game_analysis_events: no client role gets a policy or any
-- grant. The coach function reads and writes it with the service-role key.
-- Forward-only and safe to rerun; it changes no existing table.

begin;

create table if not exists public.game_coach_notes (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  analysis text not null check (length(analysis) > 0),
  recording_quality text,
  truncated boolean not null default false,
  model text,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

-- Quota lookups count a user's notes.
create index if not exists game_coach_notes_user_idx
  on public.game_coach_notes (user_id);

alter table public.game_coach_notes enable row level security;

revoke all on table public.game_coach_notes from public, anon, authenticated;
grant select, insert on table public.game_coach_notes to service_role;

commit;
