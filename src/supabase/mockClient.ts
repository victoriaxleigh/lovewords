// In-memory mock of the Supabase client for offline UI debugging.
// Activated by `src/supabase/config.ts` when `?dev=1` is present in the URL.
// Auto-signs you in as a fake user; all writes/reads are local to this tab.

type Row = Record<string, any>;

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_USER = {
  id: FAKE_USER_ID,
  email: 'dev@local',
  user_metadata: { display_name: 'Dev' },
};

const stores: Record<string, Row[]> = { games: [], profiles: [], love_notes: [] };
stores.profiles.push({ id: FAKE_USER_ID, email: FAKE_USER.email, display_name: 'Dev' });

// Browser-console handle for driving hard-to-reach states in dev
// (e.g. flip a game to 'finished' to test the game-over screen).
(globalThis as any).__lwMockStores = stores;

const authListeners: Array<(event: string, session: any) => void> = [];
const channelListeners: Array<{ table: string; cb: (payload?: any) => void }> = [];

let currentSession: any = { user: FAKE_USER };

function uuid(): string {
  return (globalThis as any).crypto.randomUUID();
}

function fireChannel(table: string, payload: any) {
  for (const l of channelListeners.filter((l) => l.table === table)) {
    try { l.cb(payload); } catch { /* ignore */ }
  }
}

// After mutating __lwMockStores in the browser console, call
// __lwMockNotify('games') to make active subscriptions refetch immediately.
(globalThis as any).__lwMockNotify = (table = 'games') => {
  fireChannel(table, { eventType: 'UPDATE' });
};

class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private table: string;
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: any = null;
  private filters: Array<{ kind: 'eq' | 'or'; col?: string; val?: any; expr?: string }> = [];
  private orderCol?: string;
  private orderAsc = true;
  private isSingle = false;
  private returnSelect = false;

  constructor(table: string) {
    this.table = table;
  }

  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this; }
  upsert(payload: any) { this.op = 'upsert'; this.payload = payload; return this; }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }

  select(_cols?: string) {
    if (this.op === 'insert' || this.op === 'upsert' || this.op === 'update') {
      this.returnSelect = true;
    } else {
      this.op = 'select';
    }
    return this;
  }

  eq(col: string, val: any) { this.filters.push({ kind: 'eq', col, val }); return this; }
  or(expr: string) { this.filters.push({ kind: 'or', expr }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  single() { this.isSingle = true; return this; }

  private match(row: Row): boolean {
    for (const f of this.filters) {
      if (f.kind === 'eq' && row[f.col!] !== f.val) return false;
      if (f.kind === 'or') {
        const ok = f.expr!.split(',').some((clause) => {
          const m = clause.match(/^([^.]+)\.eq\.(.+)$/);
          return m ? row[m[1]] === m[2] : false;
        });
        if (!ok) return false;
      }
    }
    return true;
  }

  private async execute(): Promise<{ data: any; error: any }> {
    const store = (stores[this.table] ||= []);
    const nowISO = () => new Date().toISOString();
    try {
      switch (this.op) {
        case 'select': {
          let rows = store.filter((r) => this.match(r));
          if (this.orderCol) {
            const col = this.orderCol;
            const dir = this.orderAsc ? 1 : -1;
            rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * dir);
          }
          if (this.isSingle) {
            return rows.length
              ? { data: rows[0], error: null }
              : { data: null, error: { message: 'No row found' } };
          }
          return { data: rows, error: null };
        }
        case 'insert': {
          const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
          const inserted: Row[] = inputs.map((p) => ({
            id: p.id ?? uuid(),
            created_at: nowISO(),
            updated_at: nowISO(),
            ...p,
          }));
          store.push(...inserted);
          inserted.forEach((r) => fireChannel(this.table, { eventType: 'INSERT', new: r }));
          if (this.returnSelect) {
            return this.isSingle
              ? { data: inserted[0], error: null }
              : { data: inserted, error: null };
          }
          return { data: null, error: null };
        }
        case 'update': {
          const updated: Row[] = [];
          for (const row of store) {
            if (this.match(row)) {
              Object.assign(row, this.payload, { updated_at: nowISO() });
              updated.push(row);
            }
          }
          updated.forEach((r) => fireChannel(this.table, { eventType: 'UPDATE', new: r }));
          return { data: updated, error: null };
        }
        case 'delete': {
          const keep: Row[] = [];
          const gone: Row[] = [];
          for (const row of store) (this.match(row) ? gone : keep).push(row);
          stores[this.table] = keep;
          gone.forEach((r) => fireChannel(this.table, { eventType: 'DELETE', old: r }));
          return { data: gone, error: null };
        }
        case 'upsert': {
          const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
          for (const p of inputs) {
            // Determine the conflict key. Most tables use 'id'; push_subscriptions
            // uses 'user_id' (the real client passes { onConflict: 'user_id' }).
            // We infer it: if the row has no 'id' field but has 'user_id', use that.
            const conflictKey =
              p.id !== undefined ? 'id' : p.user_id !== undefined ? 'user_id' : 'id';
            const conflictVal = p[conflictKey];
            const idx = store.findIndex((r) => r[conflictKey] === conflictVal);
            if (idx >= 0) Object.assign(store[idx], p, { updated_at: nowISO() });
            else store.push({ created_at: nowISO(), updated_at: nowISO(), ...p });
          }
          return { data: null, error: null };
        }
      }
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
    return { data: null, error: null };
  }

  then<T1 = any, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }
}

class MockChannel {
  private listener?: { table: string; cb: (payload: any) => void };
  constructor(public name: string) {}
  on(_event: string, opts: { table: string }, cb: (payload: any) => void) {
    this.listener = { table: opts.table, cb };
    channelListeners.push(this.listener);
    return this;
  }
  subscribe() { return this; }
  _unsubscribe() {
    if (!this.listener) return;
    const i = channelListeners.indexOf(this.listener);
    if (i >= 0) channelListeners.splice(i, 1);
    this.listener = undefined;
  }
}

export const mockSupabase = {
  auth: {
    signUp: async ({ email, options }: any) => {
      currentSession = { user: { ...FAKE_USER, email, user_metadata: options?.data ?? {} } };
      authListeners.forEach((l) => l('SIGNED_IN', currentSession));
      return { data: { user: currentSession.user }, error: null };
    },
    signInWithPassword: async ({ email }: any) => {
      currentSession = { user: { ...FAKE_USER, email } };
      authListeners.forEach((l) => l('SIGNED_IN', currentSession));
      return { data: { user: currentSession.user }, error: null };
    },
    signOut: async () => {
      currentSession = null;
      authListeners.forEach((l) => l('SIGNED_OUT', null));
    },
    getSession: async () => ({ data: { session: currentSession } }),
    onAuthStateChange: (cb: (event: string, session: any) => void) => {
      authListeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              const i = authListeners.indexOf(cb);
              if (i >= 0) authListeners.splice(i, 1);
            },
          },
        },
      };
    },
  },
  from: (table: string) => new QueryBuilder(table),
  channel: (name: string) => new MockChannel(name),
  removeChannel: (ch: MockChannel) => ch._unsubscribe?.(),
};
