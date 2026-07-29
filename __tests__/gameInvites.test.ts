jest.mock('../src/supabase/config', () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
    auth: { getSession: jest.fn(), refreshSession: jest.fn() },
  },
}));

import {
  acceptGameInvite,
  cancelGameInvite,
  createGameInvite,
  declineGameInvite,
  getUserGameCount,
  sendNudge,
  subscribeToUserGames,
} from '../src/supabase/gameService';
import { supabase } from '../src/supabase/config';
import { Game, Player } from '../src/types';

const INVITER = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';

const inviter: Player = {
  uid: INVITER,
  displayName: 'Inviter',
  email: 'inviter@example.com',
  score: 0,
  rack: [],
};
const recipient: Player = {
  uid: RECIPIENT,
  displayName: 'Recipient',
  email: '',
  score: 0,
  rack: [],
};

function waitingGame(): Game {
  return {
    id: 'invite-id',
    players: [inviter, recipient],
    board: [],
    bag: [],
    currentTurn: INVITER,
    status: 'waiting',
    mode: 'friend',
    moves: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function mockScopedMutation() {
  const single = jest.fn().mockResolvedValue({ data: { id: 'invite-id' }, error: null });
  const select = jest.fn().mockReturnValue({ single });
  const builder: any = { select };
  builder.eq = jest.fn().mockReturnValue(builder);
  const update = jest.fn().mockReturnValue(builder);
  (supabase.from as jest.Mock).mockReturnValue({ update });
  return { update, builder };
}

describe('waiting game invitations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          user: { id: INVITER },
        },
      },
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  test('creates an inert waiting row and sends a best-effort invite notification', async () => {
    let payload: any;
    const single = jest.fn().mockResolvedValue({ data: { id: 'invite-id' }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn((value) => {
      payload = value;
      return { select };
    });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await expect(createGameInvite(inviter, recipient, 'friend')).resolves.toBe('invite-id');
    await Promise.resolve();

    expect(payload).toMatchObject({
      status: 'waiting',
      current_turn: INVITER,
      bag: [],
      moves: [],
    });
    expect(payload.players[0].rack).toEqual([]);
    expect(payload.players[1].rack).toEqual([]);
    expect(payload.players[0].email).toBe('');
    expect(payload.players[1].email).toBe('');
    expect(payload.players[0].historyVersion).toBe(2);
    expect(payload.players[1].historyVersion).toBe(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/notify'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: expect.stringContaining('"type":"invite"'),
      })
    );
    expect((global.fetch as jest.Mock).mock.calls[0][1].body).not.toContain('senderName');
  });

  test('recipient acceptance deals both racks and keeps inviter first', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { id: RECIPIENT } } },
    });
    const { update, builder } = mockScopedMutation();

    await acceptGameInvite(waitingGame());

    const payload = update.mock.calls[0][0];
    expect(payload.status).toBe('active');
    expect(payload.current_turn).toBe(INVITER);
    expect(payload.players[0].rack).toHaveLength(7);
    expect(payload.players[1].rack).toHaveLength(7);
    expect(payload.players[0].historyVersion).toBe(2);
    expect(payload.players[1].historyVersion).toBe(2);
    expect(payload.bag).toHaveLength(90);
    expect(builder.eq).toHaveBeenCalledWith('status', 'waiting');
    expect(builder.eq).toHaveBeenCalledWith('player2_uid', RECIPIENT);
  });

  test('sender cannot accept or decline an invitation', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { id: INVITER } } },
    });

    await expect(acceptGameInvite(waitingGame())).rejects.toThrow('invited player');
    await expect(declineGameInvite(waitingGame())).rejects.toThrow('invited player');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('recipient cannot cancel an outgoing invitation', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { id: RECIPIENT } } },
    });

    await expect(cancelGameInvite(waitingGame())).rejects.toThrow('sender');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('decline and sender cancellation mark waiting rows declined with scoped updates', async () => {
    (supabase.auth.getSession as jest.Mock)
      .mockResolvedValueOnce({ data: { session: { user: { id: RECIPIENT } } } })
      .mockResolvedValueOnce({ data: { session: { user: { id: INVITER } } } });
    const first = mockScopedMutation();
    await declineGameInvite(waitingGame());
    expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }));
    expect(first.builder.eq).toHaveBeenCalledWith('player2_uid', RECIPIENT);

    const second = mockScopedMutation();
    await cancelGameInvite(waitingGame());
    expect(second.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }));
    expect(second.builder.eq).toHaveBeenCalledWith('player1_uid', INVITER);
  });

  test('free-game count includes only active and finished games', async () => {
    const builder: any = {};
    builder.or = jest.fn().mockReturnValue(builder);
    builder.in = jest.fn().mockResolvedValue({ count: 2, error: null });
    const select = jest.fn().mockReturnValue(builder);
    (supabase.from as jest.Mock).mockReturnValue({ select });

    await expect(getUserGameCount(INVITER)).resolves.toBe(2);
    expect(builder.in).toHaveBeenCalledWith('status', ['active', 'finished']);
  });

  test('filters declined games in the database query', async () => {
    const builder: any = {};
    builder.or = jest.fn().mockReturnValue(builder);
    builder.neq = jest.fn().mockReturnValue(builder);
    builder.order = jest.fn().mockResolvedValue({ data: [], error: null });
    const select = jest.fn().mockReturnValue(builder);
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const channel: any = {};
    channel.on = jest.fn().mockReturnValue(channel);
    channel.subscribe = jest.fn().mockReturnValue(channel);
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    const onUpdate = jest.fn();
    const unsubscribe = subscribeToUserGames(INVITER, onUpdate);
    await Promise.resolve();
    await Promise.resolve();

    expect(builder.neq).toHaveBeenCalledWith('status', 'declined');
    expect(onUpdate).toHaveBeenCalledWith([]);

    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  test('returns the server-owned nudge cooldown instead of reporting false success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 429 });

    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('cooldown');

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('sent');
  });

  test('refreshes a rejected session and retries the nudge once with the new token', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
      error: null,
    });

    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('sent');

    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization)
      .toBe('Bearer access-token');
    expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization)
      .toBe('Bearer refreshed-token');
  });

  test('preserves cooldown and failure results after the single authentication retry', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
      error: null,
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 429 });

    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('cooldown');

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('failed');

    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('does not refresh or retry a non-authentication server failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 502 });

    await expect(sendNudge(RECIPIENT, 'invite-id')).resolves.toBe('failed');

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
