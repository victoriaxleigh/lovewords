import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { GameMode } from '../types';
import { Colors } from '../utils/colors';
import { RADII } from '../utils/styles';

type Props = {
  visible: boolean;
  onClose: () => void;
  onStart: (email: string, mode: GameMode) => void;
  onStartSolo: () => void;
  inviting: boolean;
  startingSolo: boolean;
  errorMsg: string | null;
  onClearError: () => void;
};

export default function NewGameModal({
  visible,
  onClose,
  onStart,
  onStartSolo,
  inviting,
  startingSolo,
  errorMsg,
  onClearError,
}: Props) {
  const [mode, setMode] = useState<GameMode>('partner');
  const [email, setEmail] = useState('');

  const busy = inviting || startingSolo;

  function handleClose() {
    if (busy) return;
    setEmail('');
    onClearError();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>New Game 💌</Text>
          <TouchableOpacity onPress={handleClose} accessibilityLabel="Close new game" accessibilityRole="button">
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* Mode toggle */}
          <Text style={styles.label}>Who are you playing with?</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modePill, mode === 'partner' && styles.modePillActive]}
              onPress={() => setMode('partner')}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'partner' }}
            >
              <Text style={[styles.modePillText, mode === 'partner' && styles.modePillTextActive]}>
                💕 Partner
              </Text>
              <Text style={[styles.modeSub, mode === 'partner' && styles.modeSubActive]}>
                Love notes & the works
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modePill, mode === 'friend' && styles.modePillActive]}
              onPress={() => setMode('friend')}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'friend' }}
            >
              <Text style={[styles.modePillText, mode === 'friend' && styles.modePillTextActive]}>
                🎲 Friend
              </Text>
              <Text style={[styles.modeSub, mode === 'friend' && styles.modeSubActive]}>
                Just messages & smack talk
              </Text>
            </TouchableOpacity>
          </View>

          {/* Email invite */}
          <Text style={[styles.label, { marginTop: 20 }]}>Their email</Text>
          <TextInput
            style={styles.input}
            placeholder="Friend's email"
            placeholderTextColor={Colors.textLight}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (errorMsg) onClearError();
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Their email address"
          />

          {errorMsg ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.startBtn, (!email.trim() || busy) && styles.startBtnDisabled]}
            onPress={() => onStart(email, mode)}
            disabled={!email.trim() || busy}
          >
            {inviting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.startBtnText}>Start Game</Text>
            )}
          </TouchableOpacity>

          {/* Solo practice */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.soloBtn}
            onPress={onStartSolo}
            disabled={busy}
            accessibilityRole="button"
          >
            {startingSolo ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <Text style={styles.soloBtnText}>🎯 Practice Solo</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.primaryDark },
  close: { fontSize: 16, color: Colors.primaryDark, fontWeight: '600' },
  body: { padding: 20 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  modeRow: { flexDirection: 'row', gap: 12 },
  modePill: {
    flex: 1,
    borderRadius: RADII.lg,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modePillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.tilePlaced,
  },
  modePillText: { fontSize: 16, fontWeight: '800', color: Colors.textLight },
  modePillTextActive: { color: Colors.primaryDark },
  modeSub: { fontSize: 11, color: Colors.textLight, marginTop: 4, textAlign: 'center' },
  modeSubActive: { color: Colors.primaryDark },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.md,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorBanner: {
    backgroundColor: '#FFF0F0',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: { fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  startBtn: {
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  startBtnDisabled: { backgroundColor: Colors.border },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textLight, fontSize: 13 },
  soloBtn: {
    borderRadius: RADII.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  soloBtnText: { color: Colors.primaryDark, fontSize: 15, fontWeight: '700' },
});
