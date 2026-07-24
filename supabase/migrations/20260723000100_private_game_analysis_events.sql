-- Private analysis history for versioned game events.
-- Safe to run against an existing LoveWords schema and safe to rerun.

begin;

create table if not exists public.game_analysis_events (
  game_id uuid not null references public.games(id) on delete cascade,
  event_index integer not null check (event_index >= 0),
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, event_index)
);

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

drop trigger if exists capture_game_analysis_events_before_update on public.games;
create trigger capture_game_analysis_events_before_update
  before update of moves, players on public.games
  for each row execute function public.capture_game_analysis_events();

-- Preserve analysis fields already written by the pre-migration v2 client.
insert into public.game_analysis_events (game_id, event_index, event)
select
  games.id,
  (events.ordinal - 1)::integer,
  events.item
from public.games
cross join lateral jsonb_array_elements(games.moves)
  with ordinality as events(item, ordinal)
where events.item ->> 'version' = '2'
on conflict (game_id, event_index) do nothing;

-- Remove hidden fields from every participant-readable public history.
update public.games
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

alter table public.game_analysis_events enable row level security;

-- Remove the iteration-2 finished-game client policy if it was ever deployed.
drop policy if exists "finished_game_analysis_events_read"
  on public.game_analysis_events;

revoke all on table public.game_analysis_events
  from public, anon, authenticated;
grant select on table public.game_analysis_events to service_role;
revoke execute on function public.capture_game_analysis_events()
  from public, anon, authenticated;

commit;
