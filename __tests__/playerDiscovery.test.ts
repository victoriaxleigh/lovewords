jest.mock('../src/supabase/config', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

import {
  getDiscoverability,
  getUserByEmail,
  searchProfiles,
  setDiscoverability,
} from '../src/supabase/authService';
import { supabase } from '../src/supabase/config';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;

describe('privacy-safe profile discovery helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does not call search RPC for queries shorter than three trimmed characters', async () => {
    await expect(searchProfiles('  al ')).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('maps only public search fields and preserves duplicate-name player codes', async () => {
    rpc.mockResolvedValue({
      data: [
        { profile_id: 'one', display_name: 'Alex Morgan', player_code: 'ABC123' },
        { profile_id: 'two', display_name: 'Alex Morgan', player_code: 'DEF456' },
      ],
      error: null,
    });

    const results = await searchProfiles('  Ale ');

    expect(rpc).toHaveBeenCalledWith('search_profiles', { search_query: 'Ale' });
    expect(results).toEqual([
      { profileId: 'one', displayName: 'Alex Morgan', playerCode: 'ABC123' },
      { profileId: 'two', displayName: 'Alex Morgan', playerCode: 'DEF456' },
    ]);
    expect(JSON.stringify(results)).not.toContain('email');
  });

  test('keeps exact-email lookup behind its RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'one', display_name: 'Alex', email: 'alex@example.com' }],
      error: null,
    });

    await expect(getUserByEmail(' ALEX@EXAMPLE.COM ')).resolves.toEqual({
      id: 'one',
      display_name: 'Alex',
    });
    expect(rpc).toHaveBeenCalledWith('find_profile_by_email', {
      lookup_email: 'alex@example.com',
    });
  });

  test('loads and updates only the signed-in profile discoverability field', async () => {
    const single = jest.fn().mockResolvedValue({ data: { discoverable: true }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select, update });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });

    await expect(getDiscoverability()).resolves.toBe(true);
    await setDiscoverability(false);

    expect(select).toHaveBeenCalledWith('discoverable');
    expect(update).toHaveBeenCalledWith({ discoverable: false });
    expect(eq).toHaveBeenCalledWith('id', 'me');
  });
});
