import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  listWordRequests,
  reviewWord,
  NwlStatus,
  PendingWord,
} from '../supabase/wordRequests';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';

// Reviewer-only: words players asked to add, most-requested first. Settings
// only links here for accounts the word-requests function accepts as reviewers.

const NWL_LABEL: Record<NwlStatus, string> = {
  in_nwl: 'In NWL ✅',
  not_in_nwl: 'Not in NWL ❌',
  not_checked: 'NWL not checked yet',
};

export default function WordRequestsScreen() {
  const navigation = useNavigation<any>();
  const [requests, setRequests] = useState<PendingWord[] | null>(null);
  const [nwlAvailable, setNwlAvailable] = useState(false);
  const [busyWord, setBusyWord] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listWordRequests();
      if (!list) {
        setError("This account can't review word requests.");
        setRequests([]);
        return;
      }
      setRequests(list.requests);
      setNwlAvailable(list.nwlAvailable);
    } catch (err: any) {
      setError(err.message ?? "Couldn't load word requests.");
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(word: string, decision: 'approve' | 'reject') {
    setBusyWord(word);
    setError(null);
    try {
      await reviewWord(word, decision);
      setRequests((prev) => (prev ?? []).filter((entry) => entry.word !== word));
    } catch (err: any) {
      setError(err.message ?? "Couldn't save that decision.");
    } finally {
      setBusyWord(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" accessibilityRole="button">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Word requests</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!nwlAvailable && requests !== null && requests.length > 0 && (
          <Text style={styles.note}>
            The NWL check switches on once the licensed word list is installed. Until then, it's
            your call 📖
          </Text>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)} accessibilityLabel="Dismiss error" accessibilityRole="button">
              <Text style={styles.errorDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {requests === null ? (
          <ActivityIndicator color={Colors.primary} style={styles.loading} />
        ) : requests.length === 0 && !error ? (
          <Text style={styles.empty}>No requests waiting. All caught up 📭</Text>
        ) : (
          requests.map((entry) => {
            const busy = busyWord === entry.word;
            return (
              <View key={entry.word} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.cardCopy}>
                    <Text style={styles.word}>{entry.word}</Text>
                    <Text style={styles.meta}>
                      Asked by {entry.count} {entry.count === 1 ? 'player' : 'players'}
                    </Text>
                  </View>
                  <View style={styles.nwlPill}>
                    <Text style={styles.nwlPillText}>{NWL_LABEL[entry.nwl]}</Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.rejectBtn, busy && styles.disabled]}
                    onPress={() => decide(entry.word, 'reject')}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Reject ${entry.word}`}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveBtn, busy && styles.approveBtnDisabled]}
                    onPress={() => decide(entry.word, 'approve')}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${entry.word} to the dictionary`}
                  >
                    {busy ? (
                      <ActivityIndicator color={Colors.surface} />
                    ) : (
                      <Text style={styles.approveBtnText}>Add word</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
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
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  note: {
    fontSize: 13,
    fontWeight: '600',
    fontStyle: 'italic',
    color: Colors.textLight,
    marginBottom: 12,
    lineHeight: 18,
  },
  loading: { marginTop: 32 },
  empty: {
    fontSize: 14,
    fontWeight: '600',
    fontStyle: 'italic',
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 32,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    padding: 14,
    marginBottom: 12,
    ...SHADOWS.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardCopy: { flex: 1 },
  word: { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: 1 },
  meta: { fontSize: 12, fontWeight: '600', color: Colors.textLight, marginTop: 2 },
  nwlPill: {
    backgroundColor: Colors.tilePlaced,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  nwlPillText: { fontSize: 12, fontWeight: '700', color: Colors.primaryDark },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  rejectBtn: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rejectBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  approveBtn: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.primary,
    ...SHADOWS.btn,
  },
  approveBtnDisabled: { backgroundColor: Colors.border },
  approveBtnText: { fontSize: 14, fontWeight: '800', color: Colors.surface },
  disabled: { opacity: 0.6 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  errorDismiss: { fontSize: 15, color: Colors.errorDark, fontWeight: '700', paddingLeft: 8 },
});
