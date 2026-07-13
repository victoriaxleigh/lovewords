import React, { useState } from 'react';
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

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!email || !password) { setError('Please fill in all fields'); return; }
    if (mode === 'register' && !displayName) { setError('Please enter your name'); return; }

    setLoading(true);
    try {
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../assets/icon.png')}
          style={styles.logo}
          accessibilityLabel="LoveWords icon"
        />
        <Text style={styles.title}>LoveWords</Text>
        <Text style={styles.subtitle}>A game for word lovers 💬</Text>

        {mode === 'register' && (
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

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)} accessibilityLabel="Dismiss error">
              <Text style={styles.errorDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          <Text style={styles.switchText}>
            {mode === 'login'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
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
    paddingHorizontal: 32,
  },
  logo: {
    width: 90,
    height: 90,
    borderRadius: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: Colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textLight,
    marginBottom: 40,
  },
  input: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: RADII.md,
    padding: 14,
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
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { flex: 1, fontSize: 13, color: '#C0392B', fontWeight: '600' },
  errorDismiss: { fontSize: 15, color: '#C0392B', fontWeight: '700', paddingLeft: 8 },
  button: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    ...SHADOWS.btn,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  switchText: { color: Colors.primaryDark, fontSize: 14, textDecorationLine: 'underline' },
});
