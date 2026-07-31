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
import { login, register } from '../supabase/authService';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import {
  formatInviteCode,
  getInviteCodeFromLocation,
  isValidInviteCode,
  normalizeInviteCode,
} from '../utils/invites';
import { stashPendingInvite } from '../utils/pendingInvite';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const hasInvite = isValidInviteCode(inviteCode);

  // Someone opening an invite link (?invite=CODE) lands here to sign up. Capture
  // the code, nudge them toward creating an account, and stash it so it survives
  // the round-trip through registration (which may require email confirmation).
  useEffect(() => {
    const fromUrl = getInviteCodeFromLocation();
    if (fromUrl) {
      setInviteCode(fromUrl);
      setMode('register');
      void stashPendingInvite(fromUrl);
    }
  }, []);

  async function handleSubmit() {
    setError(null);
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

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
  }

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

          {/* Segmented toggle */}
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
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textLight}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            accessibilityLabel="Password"
          />
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

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => setError(null)} accessibilityLabel="Dismiss error">
                <Text style={styles.errorDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading} accessibilityRole="button">
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{isRegister ? 'Create account' : 'Sign in'}</Text>
            )}
          </TouchableOpacity>
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
