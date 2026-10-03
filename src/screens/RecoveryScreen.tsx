import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../supabase/config';
import { endRecoverySession, updatePassword } from '../supabase/authService';
import { validateNewPassword, MIN_PASSWORD_LENGTH } from '../utils/passwordRecovery';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';

type Phase = 'checking' | 'form' | 'saving' | 'done' | 'expired';

// Shown instead of the app whenever a password-recovery link is in play (see
// App.tsx). The recovery link gives us a session but no password, so this
// screen never hands that session to the rest of the app: the user either sets
// a new password (then is signed out and sent to sign in with it) or cancels
// (also signed out).
export default function RecoveryScreen({
  onFinished,
}: {
  // Called once the user leaves this screen. `email` is set after a successful
  // reset so the sign-in form can be prefilled.
  onFinished: (result: { updated: boolean; email: string | null }) => void;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // getSession() waits for the client to finish consuming the link, so this
  // tells us whether the token was accepted.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setEmail(session?.user?.email ?? null);
      setPhase(session ? 'form' : 'expired');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setError(null);
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setPhase('saving');
    try {
      await updatePassword(password);
    } catch (err: any) {
      setError(err.message ?? 'Could not update your password. Try again.');
      setPhase('form');
      return;
    }
    // Drop the recovery session: the user proves the new password by signing in.
    await endRecoverySession().catch(() => {});
    setPassword('');
    setConfirm('');
    setPhase('done');
  }

  async function handleCancel() {
    await endRecoverySession().catch(() => {});
    onFinished({ updated: false, email: null });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.card}>
          {phase === 'checking' && <ActivityIndicator color={Colors.primary} size="large" />}

          {phase === 'expired' && (
            <>
              <Text style={styles.title}>Reset link expired</Text>
              <Text style={styles.body}>
                This password reset link is invalid, expired, or was already used. Request a new one
                from the sign-in screen.
              </Text>
              <TouchableOpacity
                style={styles.button}
                onPress={handleCancel}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}

          {(phase === 'form' || phase === 'saving') && (
            <>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.body}>
                {email ? `For ${email}. ` : ''}Use at least {MIN_PASSWORD_LENGTH} characters.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={Colors.textLight}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                accessibilityLabel="New password"
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textLight}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                accessibilityLabel="Confirm new password"
                onSubmitEditing={handleSave}
              />

              {error && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.button}
                onPress={handleSave}
                disabled={phase === 'saving'}
                accessibilityRole="button"
              >
                {phase === 'saving' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Set new password</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={handleCancel}
                disabled={phase === 'saving'}
                accessibilityRole="button"
              >
                <Text style={styles.linkText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {phase === 'done' && (
            <>
              <Text style={styles.title}>Password updated ✓</Text>
              <Text style={styles.body}>
                Your new password is saved. Sign in with it to get back to your games.
              </Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => onFinished({ updated: true, email })}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Go to sign in</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 20,
    ...SHADOWS.card,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.primaryDark,
    marginBottom: 8,
  },
  body: { fontSize: 14, color: Colors.text, lineHeight: 20, marginBottom: 16 },
  input: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: RADII.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  errorBanner: {
    width: '100%',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  button: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    ...SHADOWS.btn,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  linkBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  linkText: { fontSize: 14, color: Colors.primaryDark, fontWeight: '700' },
});
