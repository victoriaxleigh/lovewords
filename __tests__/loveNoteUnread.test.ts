jest.mock('../src/supabase/config', () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import {
  countUnreadNotesByGame,
  markGameNotesRead,
  subscribeToUnreadNoteCounts,
} from '../src/supabase/gameService';
import { supabase } from '../src/supabase/config';

const ME = '11111111-1111-4111-8111-111111111111';

// A chainable query builder that records every filter and resolves to `result`.
function queryBuilder(result: { data: any; error: any }) {
  const calls: Array<[string, ...any[]]> = [];
  const builder: any = {
    calls,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'update', 'eq']) {
    builder[method] = jest.fn((...args: any[]) => {
      calls.push([method, ...args]);
      return builder;
    });
  }
  return builder;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('countUnreadNotesByGame', () => {
  test('groups unread rows into counts per game', () => {
    expect(
      countUnreadNotesByGame([
        { game_id: 'a' },
        { game_id: 'b' },
        { game_id: 'a' },
        { game_id: 'a' },
      ])
    ).toEqual({ a: 3, b: 1 });
  });

  test('returns an empty map when nothing is unread', () => {
    expect(countUnreadNotesByGame([])).toEqual({});
  });
});

describe('markGameNotesRead', () => {
  test('marks only my unread notes in that game read, in one update', async () => {
    const builder = queryBuilder({ data: null, error: null });
    (supabase.from as jest.Mock).mockReturnValue(builder);

    await markGameNotesRead('game-1', ME);

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('love_notes');
    expect(builder.calls).toEqual([
      ['update', { read: true }],
      ['eq', 'game_id', 'game-1'],
      ['eq', 'to_uid', ME],
      ['eq', 'read', false],
    ]);
  });
});

describe('subscribeToUnreadNoteCounts', () => {
  test('queries my unread notes, listens for every change to them, and refetches', async () => {
    const results = [
      { data: [{ game_id: 'a' }, { game_id: 'a' }, { game_id: 'b' }], error: null },
      { data: [{ game_id: 'b' }], error: null },
    ];
    const builders: any[] = [];
    (supabase.from as jest.Mock).mockImplementation(() => {
      const b = queryBuilder(results[builders.length]);
      builders.push(b);
      return b;
    });
    let onChange: () => void = () => {};
    const channel: any = {
      on: jest.fn((_type: string, _opts: any, cb: () => void) => {
        onChange = cb;
        return channel;
      }),
      subscribe: jest.fn(() => channel),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    const onUpdate = jest.fn();
    const unsubscribe = subscribeToUnreadNoteCounts(ME, onUpdate);
    await flush();

    expect(builders[0].calls).toEqual([
      ['select', 'game_id'],
      ['eq', 'to_uid', ME],
      ['eq', 'read', false],
    ]);
    expect(onUpdate).toHaveBeenLastCalledWith({ a: 2, b: 1 });
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'love_notes', filter: `to_uid=eq.${ME}` },
      expect.any(Function)
    );

    onChange();
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({ b: 1 });

    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  test('gives each subscription its own channel so lobby and game screen can coexist', () => {
    (supabase.from as jest.Mock).mockReturnValue(queryBuilder({ data: [], error: null }));
    const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    subscribeToUnreadNoteCounts(ME, jest.fn());
    subscribeToUnreadNoteCounts(ME, jest.fn());

    const [first, second] = (supabase.channel as jest.Mock).mock.calls.map((c) => c[0]);
    expect(first).not.toBe(second);
  });
});
