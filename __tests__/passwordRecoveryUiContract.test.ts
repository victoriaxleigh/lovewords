import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('password recovery wiring (#26)', () => {
  const app = read('App.tsx');
  const auth = read('src/screens/AuthScreen.tsx');
  const recovery = read('src/screens/RecoveryScreen.tsx');
  const config = read('src/supabase/config.ts');

  test('snapshots the recovery URL before the Supabase client can consume it', () => {
    const importAt = config.indexOf("import '../utils/passwordRecovery'");
    expect(importAt).toBeGreaterThan(-1);
    expect(importAt).toBeLessThan(config.indexOf('createClient(SUPABASE_URL'));
  });

  test('renders the recovery screen ahead of the signed-in app', () => {
    const recoveryAt = app.indexOf("if (recovery === 'active')");
    expect(recoveryAt).toBeGreaterThan(-1);
    expect(app).toContain('<RecoveryScreen onFinished={finishRecovery} />');
    expect(recoveryAt).toBeLessThan(app.indexOf('<NavigationContainer>'));
    // The session is withheld from Lobby, push registration and invite
    // redemption until recovery is resolved.
    expect(app).toContain("const user = recovery === 'inactive' ? sessionUser : null;");
    expect(app).toContain('onPasswordRecovery(');
    expect(app).toContain('isRecoveryPending()');
  });

  test('AuthScreen offers a forgot-password link that requests a reset email', () => {
    expect(auth).toContain('Forgot password?');
    expect(auth).toContain("switchMode('forgot')");
    expect(auth).toContain('requestPasswordReset(trimmed, buildRecoveryRedirect(href))');
  });

  test('RecoveryScreen sets the password, signs out, and confirms explicitly', () => {
    expect(recovery).toContain('await updatePassword(password)');
    expect(recovery.indexOf('await updatePassword(password)')).toBeLessThan(
      recovery.indexOf("setPhase('done')")
    );
    expect(recovery).toContain('await endRecoverySession()');
    expect(recovery).toContain('Password updated');
    expect(recovery).toContain('Go to sign in');
  });
});
