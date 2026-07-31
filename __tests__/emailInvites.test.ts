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

const INVITER = '11111111-1111-4111-8111-111111111111';
const REDEEMER = '22222222-2222-4222-8222-222222222222';

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

  test('redeems then opens an active game with the inviter as the caller-created game', async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ inviter_uid: INVITER, inviter_display_name: 'Vic', mode: 'partner' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: 'new-game-id', error: null });

    const gameId = await redeemEmailInvite('love-2345', {
      uid: REDEEMER,
      displayName: 'Newbie',
    });

    expect(gameId).toBe('new-game-id');
    expect(rpc.mock.calls[0]).toEqual(['redeem_email_invite', { invite_code: 'LOVE2345' }]);

    const [fnName, args] = rpc.mock.calls[1];
    expect(fnName).toBe('create_active_game');
    // Redeemer is player one; the invite grant authorizes the pairing.
    expect(args.game_players[0].uid).toBe(REDEEMER);
    expect(args.game_players[1].uid).toBe(INVITER);
    expect(args.email_grant).toBe(true);
    expect(args.solo_game).toBe(false);
    expect(args.game_current_turn).toBe(REDEEMER);
  });

  test('throws a friendly error when the invite is gone', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Invite is no longer available' } });
    await expect(
      redeemEmailInvite('LOVE2345', { uid: REDEEMER, displayName: 'Newbie' })
    ).rejects.toThrow('no longer available');
  });
});
