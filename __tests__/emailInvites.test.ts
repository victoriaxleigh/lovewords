jest.mock('../src/supabase/config', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

import {
  createEmailInvite,
  createPhoneInvite,
  redeemEmailInvite,
  sendInviteEmail,
} from '../src/supabase/gameService';
import { supabase } from '../src/supabase/config';

const rpc = supabase.rpc as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;


describe('email invite creation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('mints a code through the RPC and builds a shareable link', async () => {
    rpc.mockResolvedValue({ data: 'LOVE2345', error: null });

    const result = await createEmailInvite('  New.Player@Example.com ', 'friend');

    expect(rpc).toHaveBeenCalledWith('create_email_invite', {
      invitee_email: 'new.player@example.com',
      invite_mode: 'friend',
    });
    expect(result.code).toBe('LOVE2345');
    expect(result.link).toContain('/?invite=LOVE2345');
  });

  test('surfaces RPC failures to the caller', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Too many invitations; try again later' } });
    await expect(createEmailInvite('a@b.com', 'partner')).rejects.toBeTruthy();
  });

  test('mints a phone invite through the phone RPC', async () => {
    rpc.mockResolvedValue({ data: 'PHON2345', error: null });

    const result = await createPhoneInvite('  (555) 123-4567 ', 'partner');

    expect(rpc).toHaveBeenCalledWith('create_phone_invite', {
      invitee_phone: '(555) 123-4567',
      invite_mode: 'partner',
    });
    expect(result.code).toBe('PHON2345');
    expect(result.link).toContain('/?invite=PHON2345');
  });
});

describe('sending an invite email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
  });

  test('reports true only when the function confirms delivery', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ emailed: true }),
    });

    await expect(sendInviteEmail('love-2345')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/send-invite'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: expect.stringContaining('"code":"LOVE2345"'),
      })
    );
  });

  test('reports false when email delivery is not configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ emailed: false, reason: 'not_configured' }),
    });
    await expect(sendInviteEmail('LOVE2345')).resolves.toBe(false);
  });

  test('never throws on a network or auth failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(sendInviteEmail('LOVE2345')).resolves.toBe(false);

    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(sendInviteEmail('LOVE2345')).resolves.toBe(false);
  });
});

describe('redeeming an invite', () => {
  beforeEach(() => jest.clearAllMocks());

  test('redeems atomically in a single RPC that returns the created game id', async () => {
    rpc.mockResolvedValueOnce({ data: 'new-game-id', error: null });

    const result = await redeemEmailInvite('love-2345');

    expect(result).toEqual({ status: 'created', gameId: 'new-game-id' });
    // One atomic call — the game is created inside redeem, not a second RPC.
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0];
    expect(fnName).toBe('redeem_email_invite');
    expect(args.invite_code).toBe('LOVE2345');
    // The client supplies the tiles, exactly as createGame does.
    expect(args.rack1).toHaveLength(7);
    expect(args.rack2).toHaveLength(7);
    expect(args.game_bag).toHaveLength(90);
    expect(Array.isArray(args.game_board)).toBe(true);
  });

  test('reports a definitive "gone" when the RPC returns no game id', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(redeemEmailInvite('LOVE2345')).resolves.toEqual({ status: 'gone' });
  });

  test('throws (retryable) on a transient RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    await expect(redeemEmailInvite('LOVE2345')).rejects.toThrow('network down');
  });
});
