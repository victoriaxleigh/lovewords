import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { login, register, requestPasswordReset } from '../supabase/authService';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { formatInviteCode, isValidInviteCode, normalizeInviteCode } from '../utils/invites';
import { readPendingInvite, stashPendingInvite } from '../utils/pendingInvite';
import { buildRecoveryRedirect } from '../utils/passwordRecovery';

type Mode = 'login' | 'register' | 'forgot';

type Notice = { message: string; kind: 'info' | 'error'; email?: string };

export default function AuthScreen({
  notice,
  onDismissNotice,
}: {
  // A message handed over by App — e.g. "password updated" after a reset, or an
  // expired-link error from the URL.
  notice?: Notice | null;
  onDismissNotice?: () => void;
} = {}) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(notice?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';
  const hasInvite = isValidInviteCode(inviteCode);

  // The invite code from a ?invite= link is captured and stashed at the app root
  // (see App.tsx). Read it back here so a new signer-up sees the banner and code
  // prefilled, and lands on the sign-up tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stashed = await readPendingInvite();
      if (!cancelled && stashed) {
        setInviteCode(stashed);
        setMode('register');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    onDismissNotice?.();
    if (isForgot) {
      await handleResetRequest();
      return;
    }
    if (!email || !password) { setError('Fill in all fields to continue'); return; }
    if (isRegister && !displayName) { setError('Add your name so friends can find you'); return; }

    setLoading(true);
    try {
      // Persist any invite code before auth so App can redeem it once a session
      // exists — even if confirmation defers the session to a later sign-in.
      if (hasInvite) await stashPendingInvite(normalizeInviteCode(inviteCode));
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest() {
    const trimmed = email.trim();
    if (!trimmed) { setError('Enter the email you signed up with'); return; }
    setLoading(true);
    try {
      const href = typeof window !== 'undefined' ? window.location?.href : null;
      await requestPasswordReset(trimmed, buildRecoveryRedirect(href));
      // Supabase doesn't reveal whether the address has an account.
      setInfo(
        `If ${trimmed} has a LoveWords account, a reset link is on its way. ` +
          'Open it on this device to choose a new password — and check your spam folder.'
      );
    } catch (err: any) {
      setError(err.message ?? 'Could not send a reset link. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  const banner = info ?? (notice?.kind === 'info' ? notice.message : null);
  const shownError = error ?? (notice?.kind === 'error' ? notice.message : null);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoHalo}>
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../assets/icon.png')}
              style={styles.logo}
              accessibilityLabel="LoveWords icon"
            />
          </View>
          <Text style={styles.title}>LoveWords</Text>
          <Text style={styles.subtitle}>A word game for the people you love 💕</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {hasInvite && (
            <View style={styles.inviteBanner}>
              <Text style={styles.inviteBannerText}>
                🎉 You've been invited to play! {isRegister ? 'Create your account' : 'Sign in'} to
                start your game.
              </Text>
              <Text style={styles.inviteBannerCode}>Code {formatInviteCode(inviteCode)}</Text>
            </View>
          )}

          {isForgot ? (
            <View style={styles.forgotHeader}>
              <Text style={styles.forgotTitle}>Reset your password</Text>
              <Text style={styles.forgotBody}>
                Enter your account email and we'll send you a link to choose a new password.
              </Text>
            </View>
          ) : (
          /* Segmented toggle */
          <View style={styles.segment}>
            <TouchableOpacity
              style={[styles.segmentBtn, !isRegister && styles.segmentBtnActive]}
              onPress={() => switchMode('login')}
              accessibilityRole="button"
              accessibilityState={{ selected: !isRegister }}
            >
              <Text style={[styles.segmentText, !isRegister && styles.segmentTextActive]}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, isRegister && styles.segmentBtnActive]}
              onPress={() => switchMode('register')}
              accessibilityRole="button"
              accessibilityState={{ selected: isRegister }}
            >
              <Text style={[styles.segmentText, isRegister && styles.segmentTextActive]}>Sign up</Text>
            </TouchableOpacity>
          </View>
          )}

          {isRegister && (
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={Colors.textLight}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              accessibilityLabel="Display name"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textLight}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email address"
          />
          {!isForgot && (
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textLight}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              accessibilityLabel="Password"
            />
          )}
          {mode === 'login' && (
            <TouchableOpacity
              style={styles.forgotLink}
              onPress={() => switchMode('forgot')}
              accessibilityRole="button"
            >
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
          {!isForgot && (
            <TextInput
              style={styles.input}
              placeholder="Invite code (optional)"
              placeholderTextColor={Colors.textLight}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Invite code"
            />
          )}

          {banner && (
            <View style={styles.infoBanner}>
              <Text style={styles.infoText}>{banner}</Text>
            </View>
          )}

          {shownError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{shownError}</Text>
              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  if (notice?.kind === 'error') onDismissNotice?.();
                }}
                accessibilityLabel="Dismiss error"
              >
                <Text style={styles.errorDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading} accessibilityRole="button">
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isForgot ? 'Send reset link' : isRegister ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </TouchableOpacity>
          {isForgot && (
            <TouchableOpacity
              style={styles.backLink}
              onPress={() => switchMode('login')}
              accessibilityRole="button"
            >
              <Text style={styles.forgotLinkText}>Back to sign in</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          {isRegister ? 'Play together, wherever you are.' : 'Welcome back — your turn awaits.'}
        </Text>
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
  hero: { alignItems: 'center', marginBottom: 28 },
  logoHalo: {
    width: 108,
    height: 108,
    borderRadius: 32,
    backgroundColor: Colors.tilePlaced,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    ...SHADOWS.btn,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 22,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: Colors.primaryDark,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 20,
    ...SHADOWS.card,
  },
  inviteBanner: {
    backgroundColor: Colors.tilePlaced,
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  inviteBannerText: { fontSize: 13, color: Colors.primaryDark, fontWeight: '700', lineHeight: 18 },
  inviteBannerCode: {
    fontSize: 13,
    color: Colors.primaryDark,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 6,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: RADII.md,
    padding: 4,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADII.sm,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: Colors.surface,
    ...SHADOWS.card,
  },
  segmentText: { fontSize: 14, fontWeight: '700', color: Colors.textLight },
  segmentTextActive: { color: Colors.primary },
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
  forgotHeader: { marginBottom: 16 },
  forgotTitle: { fontSize: 18, fontWeight: '800', color: Colors.primaryDark, marginBottom: 6 },
  forgotBody: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  forgotLink: { alignSelf: 'flex-end', marginTop: -4, marginBottom: 12, paddingVertical: 2 },
  forgotLinkText: { fontSize: 13, color: Colors.primaryDark, fontWeight: '700' },
  backLink: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  infoBanner: {
    width: '100%',
    backgroundColor: Colors.tilePlaced,
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  infoText: { fontSize: 13, color: Colors.primaryDark, fontWeight: '600', lineHeight: 18 },
  errorBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  errorDismiss: { fontSize: 15, color: Colors.errorDark, fontWeight: '700', paddingLeft: 8 },
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
  footer: {
    fontSize: 13,
    color: Colors.textLight,
    marginTop: 24,
    textAlign: 'center',
  },
});
