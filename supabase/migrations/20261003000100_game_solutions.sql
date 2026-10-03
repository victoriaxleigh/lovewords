-- Per-game cache of the post-game solve (issue #25).
-- Safe to run against an existing LoveWords schema and safe to rerun.
--
-- A finished game is immutable, so its solve never goes stale, and the solve is
-- player-independent: the asker is stamped on at read time. One row per game
-- serves /solve and /coach for both players. `solver_version` lets a solver
-- change invalidate old rows; the functions treat a mismatch as a miss and
-- overwrite it.

begin;

create table if not exists public.game_solutions (
  game_id uuid primary key references public.games(id) on delete cascade,
  solution jsonb not null check (jsonb_typeof(solution) = 'object'),
  solver_version integer not null check (solver_version > 0),
  created_at timestamptz not null default now()
);

alter table public.game_solutions enable row level security;

-- Backend-only, like game_analysis_events. No client role receives a policy or
-- table privilege; the service-role solve/coach functions read and upsert it.
revoke all on table public.game_solutions from public, anon, authenticated;
grant select, insert, update on table public.game_solutions to service_role;

commit;
