jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const webpush = require('web-push');
const { handler } = require('../netlify/functions/notify');

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000';
const SENDER_ID = 'a3f035b6-8b32-4c24-826b-f16e381ed80a';
const RECIPIENT_ID = '6480cd75-0d45-43c0-81a5-a53428879e99';
const ACCESS_TOKEN = 'user-access-token';

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

function event(body: Record<string, unknown>, authorization = `Bearer ${ACCESS_TOKEN}`) {
  const normalizedBody =
    body.type === 'invite' && body.eventId === undefined
      ? { ...body, eventId: body.gameId }
      : body;
  return {
    httpMethod: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(normalizedBody),
  };
}

describe('authenticated notification handler', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    global.fetch = jest.fn();
    webpush.sendNotification.mockClear();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('rejects missing bearer authentication before service-role lookup', async () => {
    const result = await handler(
      event({ recipientUid: RECIPIENT_ID, gameId: GAME_ID, type: 'invite' }, '')
    );

    expect(result.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects unknown notification types', async () => {
    const result = await handler(
      event({ recipientUid: RECIPIENT_ID, gameId: GAME_ID, type: 'spoof' })
    );

    expect(result.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects callers without the required game relationship', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: RECIPIENT_ID,
            player2_uid: SENDER_ID,
            status: 'waiting',
            current_turn: RECIPIENT_ID,
            mode: 'partner',
          },
        ])
      );

    const result = await handler(
      event({ recipientUid: RECIPIENT_ID, gameId: GAME_ID, type: 'invite' })
    );

    expect(result.statusCode).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('derives sender name and mode after authorizing the game relationship', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: SENDER_ID,
            player2_uid: RECIPIENT_ID,
            status: 'waiting',
            current_turn: SENDER_ID,
            mode: 'friend',
          },
        ])
      )
      .mockResolvedValueOnce(response(200, true))
      .mockResolvedValueOnce(response(200, [{ display_name: 'Server Name' }]))
      .mockResolvedValueOnce(
        response(200, [{ endpoint: 'https://push.example', p256dh: 'key', auth: 'auth' }])
      )
      .mockResolvedValueOnce(response(200, []));

    const result = await handler(
      event({
        recipientUid: RECIPIENT_ID,
        gameId: GAME_ID,
        type: 'invite',
        senderName: 'Forged Name',
        isFriend: false,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(payload.title).toContain('Server Name');
    expect(payload.title).toContain('🎲');
    expect(payload.title).not.toContain('Forged Name');
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`
    );
    expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain(
      '/rpc/claim_notification_delivery'
    );
    const claimBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body);
    expect(claimBody).toMatchObject({
      claim_sender_uid: SENDER_ID,
      claim_recipient_uid: RECIPIENT_ID,
      claim_notification_type: 'invite',
      claim_event_key: `invite:${GAME_ID}`,
    });
    expect(claimBody).not.toHaveProperty('claim_game_id');
  });

  test('rejects an authorized replay before reading sender or recipient push data', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: SENDER_ID,
            player2_uid: RECIPIENT_ID,
            status: 'waiting',
            current_turn: SENDER_ID,
            mode: 'partner',
          },
        ])
      )
      .mockResolvedValueOnce(response(200, false));

    const result = await handler(
      event({ recipientUid: RECIPIENT_ID, gameId: GAME_ID, type: 'invite' })
    );

    expect(result.statusCode).toBe(429);
    expect(result.body).toBe('Notification cooldown active');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('rejects a turn notification that is not bound to the latest sender move', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: SENDER_ID,
            player2_uid: RECIPIENT_ID,
            status: 'active',
            current_turn: RECIPIENT_ID,
            mode: 'partner',
            moves: [{ uid: SENDER_ID }],
          },
        ])
      );

    const result = await handler(
      event({
        recipientUid: RECIPIENT_ID,
        gameId: GAME_ID,
        type: 'turn',
        eventId: '9',
      })
    );

    expect(result.statusCode).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('claims an authorized turn by immutable move event across all games', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: SENDER_ID,
            player2_uid: RECIPIENT_ID,
            status: 'active',
            current_turn: RECIPIENT_ID,
            mode: 'partner',
            moves: [{ uid: SENDER_ID }],
          },
        ])
      )
      .mockResolvedValueOnce(response(200, true))
      .mockResolvedValueOnce(response(200, [{ display_name: 'Server Name' }]))
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(200, []));

    const result = await handler(
      event({
        recipientUid: RECIPIENT_ID,
        gameId: GAME_ID,
        type: 'turn',
        eventId: '0',
      })
    );

    expect(result.statusCode).toBe(200);
    const claimBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body);
    expect(claimBody.claim_event_key).toBe(`turn:${GAME_ID}:0`);
    expect(claimBody).not.toHaveProperty('claim_game_id');
  });

  test('rejects a love-note push whose immutable note belongs to someone else', async () => {
    const noteId = 'db986bc1-b021-45d2-922d-98cc3536af99';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, { id: SENDER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          {
            player1_uid: SENDER_ID,
            player2_uid: RECIPIENT_ID,
            status: 'active',
            current_turn: SENDER_ID,
            mode: 'partner',
            moves: [],
          },
        ])
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            id: noteId,
            game_id: GAME_ID,
            from_uid: RECIPIENT_ID,
            to_uid: SENDER_ID,
          },
        ])
      );

    const result = await handler(
      event({
        recipientUid: RECIPIENT_ID,
        gameId: GAME_ID,
        type: 'lovenote',
        eventId: noteId,
      })
    );

    expect(result.statusCode).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
