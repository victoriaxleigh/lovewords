import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { logout, deleteAccount } from '../supabase/authService';
import { restorePurchases } from '../utils/purchases';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { Player } from '../types';

type Props = {
  currentUser: Player;
};

export default function SettingsScreen({ currentUser }: Props) {
  const navigation = useNavigation<any>();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setRestoring(true);
    setRestoreMsg(null);
    const restored = await restorePurchases();
    setRestoring(false);
    setRestoreMsg(
      restored ? "You're all set — lifetime access restored! 💕" : 'No previous purchase found for this account.'
    );
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setError(null);
    const result = await deleteAccount();
    setDeleting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not delete account. Please try again.');
      return;
    }
    // deleteAccount() calls logout() on success — App.tsx's onAuthChange
    // listener redirects to AuthScreen automatically.
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" accessibilityRole="button">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email}>{currentUser.email}</Text>
      </View>

      {Platform.OS !== 'web' && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleRestore} disabled={restoring} accessibilityRole="button">
            {restoring ? (
              <ActivityIndicator color={Colors.primary} />
            ) : (
              <Text style={styles.actionBtnText}>Restore Purchases</Text>
            )}
          </TouchableOpacity>
          {restoreMsg && <Text style={styles.hint}>{restoreMsg}</Text>}
        </View>
      )}

      <View style={styles.section}>
        <TouchableOpacity style={styles.actionBtn} onPress={logout} accessibilityRole="button">
          <Text style={styles.actionBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)} accessibilityLabel="Dismiss error">
            <Text style={styles.errorDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.dangerSection}>
        <Text style={styles.dangerTitle}>Danger Zone</Text>
        <Text style={styles.dangerHint}>
          Deleting your account permanently removes your profile and all of your
          games — including games shared with a partner. This cannot be undone.
        </Text>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => setConfirmVisible(true)}
          accessibilityRole="button"
        >
          <Text style={styles.deleteBtnText}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your account and all game history —
              including games shared with your partner. Type DELETE to confirm.
            </Text>
            <TextInput
              style={styles.confirmInput}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder="DELETE"
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              accessibilityLabel="Type DELETE to confirm"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setConfirmVisible(false);
                  setConfirmText('');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, confirmText !== 'DELETE' && styles.modalDeleteBtnDisabled]}
                onPress={handleDeleteAccount}
                disabled={confirmText !== 'DELETE' || deleting}
                accessibilityRole="button"
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 56,
  },
  back: { color: Colors.primaryDark, fontSize: 15, fontWeight: '600' },
  headerSpacer: { width: 50 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text },
  section: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: RADII.xl,
    padding: 16,
    ...SHADOWS.card,
  },
  label: { fontSize: 12, color: Colors.textLight, marginBottom: 4 },
  email: { fontSize: 15, fontWeight: '700', color: Colors.text },
  actionBtn: {
    borderRadius: RADII.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnText: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 13, color: Colors.textLight, marginTop: 8, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { flex: 1, fontSize: 13, color: '#C0392B', fontWeight: '600' },
  errorDismiss: { fontSize: 15, color: '#C0392B', fontWeight: '700', paddingLeft: 8 },
  dangerSection: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: '#FFB3B3',
    backgroundColor: '#FFF5F5',
  },
  dangerTitle: { fontSize: 14, fontWeight: '800', color: '#C0392B', marginBottom: 6 },
  dangerHint: { fontSize: 13, color: Colors.textLight, marginBottom: 14, lineHeight: 18 },
  deleteBtn: {
    borderRadius: RADII.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#C0392B',
  },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  modalBody: { fontSize: 14, color: Colors.textLight, lineHeight: 20, marginBottom: 16 },
  confirmInput: {
    backgroundColor: Colors.background,
    borderRadius: RADII.md,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  modalCancelText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  modalDeleteBtn: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#C0392B',
  },
  modalDeleteBtnDisabled: { opacity: 0.4 },
  modalDeleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
