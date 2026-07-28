import { mockSupabase } from '../src/supabase/mockClient';

describe('?dev=1 discovery mock', () => {
  test('returns discoverable duplicate names with distinct codes and no private fields', async () => {
    const { data, error } = await mockSupabase.rpc('search_profiles', {
      search_query: '  alex ',
    });
    const results = data as Array<{
      profile_id: string;
      display_name: string;
      player_code: string;
    }>;

    expect(error).toBeNull();
    expect(results).toHaveLength(2);
    expect(results[0].display_name).toBe('Alex Morgan');
    expect(results[1].display_name).toBe('Alex Morgan');
    expect(results[0].player_code).not.toBe(results[1].player_code);
    expect(JSON.stringify(results)).not.toContain('email');
    expect(JSON.stringify(results)).not.toContain('Casey');
    expect(JSON.stringify(results)).not.toContain('"Dev"');
  });

  test('supports exact-email fallback independently of discoverability', async () => {
    const { data, error } = await mockSupabase.rpc('find_profile_by_email', {
      lookup_email: 'casey@local',
    });

    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        display_name: 'Casey Private',
        email: 'casey@local',
      }),
    ]);
  });
});
