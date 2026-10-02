import { mockSupabase } from '../src/supabase/mockClient';

describe('?dev=1 password reset mock', () => {
  test('logs a recovery link built from redirectTo instead of sending email', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const { error } = await mockSupabase.auth.resetPasswordForEmail('dev@local', {
      redirectTo: 'http://localhost:8081/?dev=1',
    });
    expect(error).toBeNull();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:8081/?dev=1#type=recovery')
    );
    info.mockRestore();
  });

  test('updateUser rejects short passwords like Supabase does', async () => {
    const { error } = await mockSupabase.auth.updateUser({ password: '123' });
    expect(error?.message).toMatch(/at least 6/);
  });

  test('a password set through updateUser is required at the next sign-in', async () => {
    const { error } = await mockSupabase.auth.updateUser({ password: 'brand-new' });
    expect(error).toBeNull();
    await mockSupabase.auth.signOut();

    const wrong = await mockSupabase.auth.signInWithPassword({
      email: 'dev@local',
      password: 'old-guess',
    });
    expect(wrong.error?.message).toBe('Invalid login credentials');

    const right = await mockSupabase.auth.signInWithPassword({
      email: 'dev@local',
      password: 'brand-new',
    });
    expect(right.error).toBeNull();
  });

  test('updateUser needs a session', async () => {
    await mockSupabase.auth.signOut();
    const { error } = await mockSupabase.auth.updateUser({ password: 'whatever1' });
    expect(error?.message).toBe('Auth session missing!');
  });
});
