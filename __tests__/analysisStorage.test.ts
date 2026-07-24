import fs from 'fs';
import path from 'path';

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'supabase_schema.sql'),
  'utf8'
);
const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260723000100_private_game_analysis_events.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

describe('private analysis event schema', () => {
  test('defines idempotent private storage keyed by game and event index', () => {
    expect(schema).toMatch(/create table if not exists game_analysis_events/i);
    expect(schema).toMatch(/primary key\s*\(game_id,\s*event_index\)/i);
    expect(schema).toMatch(/game_id uuid not null references games\(id\) on delete cascade/i);
    expect(schema).toMatch(/on conflict \(game_id,\s*event_index\) do nothing/i);
  });

  test('captures appended v2 events and strips every hidden field before update', () => {
    expect(schema).toMatch(/create or replace function public\.capture_game_analysis_events/i);
    expect(schema).toMatch(/security definer/i);
    expect(schema).toMatch(/before update of moves,\s*players on games/i);
    expect(schema).toMatch(/full_event := new\.moves -> new_event_index/i);
    expect(schema).toMatch(/insert into public\.game_analysis_events/i);
    expect(schema).toMatch(
      /item - 'rackBefore' - 'drawnTiles' - 'returnedTiles'/i
    );

    const capturePosition = schema.indexOf(
      'insert into public.game_analysis_events'
    );
    const stripPosition = schema.indexOf(
      "item - 'rackBefore' - 'drawnTiles' - 'returnedTiles'"
    );
    expect(capturePosition).toBeGreaterThan(-1);
    expect(stripPosition).toBeGreaterThan(capturePosition);
  });

  test('backfills and sanitizes pre-migration v2 rows idempotently', () => {
    expect(schema).toMatch(
      /insert into game_analysis_events \(game_id,\s*event_index,\s*event\)/i
    );
    expect(schema).toMatch(/cross join lateral jsonb_array_elements\(games\.moves\)/i);
    expect(schema).toMatch(
      /\?\| array\['rackBefore',\s*'drawnTiles',\s*'returnedTiles'\]/i
    );
  });

  test('keeps complete-from-creation provenance immutable', () => {
    expect(schema).toMatch(/old\.players #>> '\{0,historyVersion\}' = '2'/i);
    expect(schema).toMatch(/old\.players #>> '\{1,historyVersion\}' = '2'/i);
    expect(schema).toMatch(/\(new\.players -> 0\) - 'historyVersion'/i);
    expect(schema).toMatch(/\(new\.players -> 1\) - 'historyVersion'/i);
  });

  test('keeps captured events entirely unreadable to client roles', () => {
    expect(schema).toMatch(/alter table game_analysis_events enable row level security/i);
    expect(schema).toMatch(
      /drop policy if exists "finished_game_analysis_events_read"/i
    );
    expect(schema).not.toMatch(
      /create policy "[^"]+"\s+on game_analysis_events/i
    );
    expect(schema).toMatch(
      /revoke all on table game_analysis_events from public,\s*anon,\s*authenticated/i
    );
    expect(schema).not.toMatch(
      /grant select on table game_analysis_events to authenticated/i
    );
    expect(schema).toMatch(
      /grant select on table game_analysis_events to service_role/i
    );
    expect(schema).toMatch(
      /revoke execute on function public\.capture_game_analysis_events\(\)[\s\S]*from public,\s*anon,\s*authenticated/i
    );
  });
});

describe('standalone analysis-storage migration', () => {
  test('is timestamped, transactional, and composed of rerunnable DDL/DML', () => {
    expect(path.basename(migrationPath)).toMatch(/^\d{14}_private_game_analysis_events\.sql$/);
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(migration).toMatch(/create table if not exists public\.game_analysis_events/i);
    expect(migration).toMatch(
      /create or replace function public\.capture_game_analysis_events/i
    );
    expect(migration).toMatch(
      /drop trigger if exists capture_game_analysis_events_before_update/i
    );
    expect(migration).toMatch(/on conflict \(game_id,\s*event_index\) do nothing/i);
    expect(migration).toMatch(
      /drop policy if exists "finished_game_analysis_events_read"/i
    );
  });

  test('contains the backfill, public scrub, and service-only permission contract', () => {
    expect(migration).toMatch(
      /cross join lateral jsonb_array_elements\(games\.moves\)/i
    );
    expect(migration).toMatch(
      /item - 'rackBefore' - 'drawnTiles' - 'returnedTiles'/i
    );
    expect(migration).toMatch(
      /revoke all on table public\.game_analysis_events[\s\S]*from public,\s*anon,\s*authenticated/i
    );
    expect(migration).toMatch(
      /grant select on table public\.game_analysis_events to service_role/i
    );
    expect(migration).not.toMatch(
      /grant select on table public\.game_analysis_events to (?:anon|authenticated)/i
    );
    expect(migration).not.toMatch(/create policy/i);
  });

  test('SETUP documents the exact database-first deployment order', () => {
    const setup = fs.readFileSync(path.join(__dirname, '..', 'SETUP.md'), 'utf8');
    const analysisSetup = setup.slice(setup.indexOf('### Finished-game analysis export'));
    expect(setup).toContain(
      'supabase/migrations/20260723000100_private_game_analysis_events.sql'
    );
    expect(analysisSetup.indexOf('SQL Editor → New query')).toBeLessThan(
      analysisSetup.indexOf('Configure the three Netlify server-only variables')
    );
    expect(
      analysisSetup.indexOf('Configure the three Netlify server-only variables')
    ).toBeLessThan(
      analysisSetup.indexOf('npm run build:web')
    );
  });
});
