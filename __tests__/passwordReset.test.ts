jest.mock('../src/supabase/config', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

import {
  endRecoverySession,
  onPasswordRecovery,
  requestPasswordReset,
  updatePassword,
} from '../src/supabase/authService';
import { supabase } from '../src/supabase/config';

const resetPasswordForEmail = supabase.auth.resetPasswordForEmail as jest.Mock;
const updateUser = supabase.auth.updateUser as jest.Mock;
const onAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const signOut = supabase.auth.signOut as jest.Mock;

describe('password reset auth helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requests a reset for the normalised email with the given redirect', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await requestPasswordReset('  Someone@Example.COM ', 'https://lovewords1234.netlify.app/');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
      redirectTo: 'https://lovewords1234.netlify.app/',
    });
  });

  test('surfaces reset-request errors such as rate limits', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new Error('Email rate limit exceeded'),
    });
    await expect(requestPasswordReset('a@b.co', 'https://x/')).rejects.toThrow(
      'Email rate limit exceeded'
    );
  });

  test('sets the new password via updateUser', async () => {
    updateUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    await expect(updatePassword('new-secret')).resolves.toEqual({ id: 'u1' });
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-secret' });
  });

  test('throws when updateUser rejects the password', async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: new Error('Auth session missing!') });
    await expect(updatePassword('new-secret')).rejects.toThrow('Auth session missing!');
  });

  test('onPasswordRecovery only fires for PASSWORD_RECOVERY and unsubscribes', () => {
    const unsubscribe = jest.fn();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    const cb = jest.fn();
    const stop = onPasswordRecovery(cb);
    const listener = onAuthStateChange.mock.calls[0][0];

    listener('SIGNED_IN', {});
    listener('INITIAL_SESSION', {});
    expect(cb).not.toHaveBeenCalled();
    listener('PASSWORD_RECOVERY', {});
    expect(cb).toHaveBeenCalledTimes(1);

    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  test('endRecoverySession signs out globally, falling back to local on failure', async () => {
    signOut.mockResolvedValueOnce({ error: null });
    await endRecoverySession();
    expect(signOut).toHaveBeenCalledTimes(1);

    signOut.mockReset();
    signOut.mockResolvedValueOnce({ error: new Error('network') }).mockResolvedValueOnce({ error: null });
    await endRecoverySession();
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });
});
