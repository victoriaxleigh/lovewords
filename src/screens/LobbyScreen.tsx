import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { createGame, createSoloGame, subscribeToUserGames, deleteGame } from '../supabase/gameService';
import { logout, getUserByEmail } from '../supabase/authService';
import { Game, Player } from '../types';
import { Colors } from '../utils/colors';
import { RADII } from '../utils/styles';
import { useNavigation } from '@react-navigation/native';

type Props = {
  currentUser: Player;
};

export default function LobbyScreen({ currentUser }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [startingSolo, setStartingSolo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigation = useNavigation<any>();

  useEffect(() => {
    const unsub = subscribeToUserGames(currentUser.uid, (g) => {
      setGames(g);
      setLoading(false);
    });
    return unsub;
  }, [currentUser.uid]);

  async function handleStartSolo() {
    setStartingSolo(true);
    setErrorMsg(null);
    try {
      const gameId = await createSoloGame(currentUser);
      navigation.navigate('Game', { gameId, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setStartingSolo(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setErrorMsg(null);
    try {
      const opponentData = await getUserByEmail(inviteEmail);
      if (!opponentData) {
        setErrorMsg('No user with that email exists. Ask them to sign up!');
        return;
      }
      const opponent: Player = {
        uid: opponentData.id,
        displayName: opponentData.display_name,
        email: opponentData.email,
        score: 0,
        rack: [],
      };
      const gameId = await createGame(currentUser, opponent);
      setInviteEmail('');
      navigation.navigate('Game', { gameId, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleDeleteGame(gameId: string) {
    setDeleting(true);
    const result = await deleteGame(gameId);
    setDeleting(false);
    if (!result.success) {
      setErrorMsg(result.error ?? 'Could not delete game.');
    }
    setDeleteConfirmId(null);
  }

  function isSoloGame(game: Game) {
    return game.players.some((p) => p.email === 'solo');
  }

  function statusLabel(game: Game) {
    if (game.status === 'finished') return '🏁 Finished';
    if (isSoloGame(game)) return '🎯 Solo practice';
    return game.currentTurn === currentUser.uid ? '💌 Your turn' : '⏳ Their turn';
  }

  function getOpponent(game: Game) {
    return game.players.find((p) => p.uid !== currentUser.uid);
  }

  function getMyScore(game: Game) {
    return game.players.find((p) => p.uid === currentUser.uid)?.score ?? 0;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {currentUser.displayName} 💕</Text>
          <Text style={styles.subtitle}>Your love word games</Text>
        </View>
        <TouchableOpacity onPress={logout} accessibilityLabel="Sign out" accessibilityRole="button">
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Invite */}
      <View style={styles.inviteBox}>
        <Text style={styles.inviteTitle}>Start a new game 💌</Text>
        <View style={styles.inviteRow}>
          <TextInput
            style={styles.inviteInput}
            placeholder="Partner's email"
            placeholderTextColor={Colors.textLight}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            accessibilityLabel="Partner's email address"
          />
          <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite} disabled={inviting}>
            {inviting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.inviteBtnText}>Go!</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Inline error */}
      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
          <TouchableOpacity onPress={() => setErrorMsg(null)} accessibilityLabel="Dismiss error" accessibilityRole="button">
            <Text style={styles.errorBannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Solo practice */}
      <TouchableOpacity
        style={styles.soloBtn}
        onPress={handleStartSolo}
        disabled={startingSolo}
      >
        {startingSolo ? (
          <ActivityIndicator color={Colors.primary} size="small" />
        ) : (
          <Text style={styles.soloBtnText}>🎯 Practice Solo</Text>
        )}
      </TouchableOpacity>

      {/* Games list */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : games.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🎲</Text>
          <Text style={styles.emptyText}>No games yet! Invite your partner above.</Text>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item: game }) => {
            const opponent = getOpponent(game);
            const myScore = getMyScore(game);
            const isMyTurn = game.currentTurn === currentUser.uid;
            const confirmingDelete = deleteConfirmId === game.id;
            return (
              <View>
                <TouchableOpacity
                  style={[styles.gameCard, isMyTurn && styles.gameCardActive]}
                  onPress={() => {
                    if (confirmingDelete) { setDeleteConfirmId(null); return; }
                    navigation.navigate('Game', { gameId: game.id, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
                  }}
                  onLongPress={() => setDeleteConfirmId(game.id)}
                  delayLongPress={500}
                  accessibilityHint="Long press to delete this game"
                >
                  <View style={styles.gameCardLeft}>
                    <Text style={styles.opponentName}>vs {opponent?.displayName ?? '?'}</Text>
                    <Text style={styles.gameStatus}>{statusLabel(game)}</Text>
                  </View>
                  <View style={styles.gameCardRight}>
                    <Text style={styles.gameScore}>
                      {myScore} – {opponent?.score ?? 0}
                    </Text>
                  </View>
                </TouchableOpacity>
                {confirmingDelete && (
                  <View style={styles.deleteConfirm}>
                    <Text style={styles.deleteConfirmText}>Delete this game?</Text>
                    <View style={styles.deleteConfirmBtns}>
                      <TouchableOpacity style={styles.deleteCancelBtn} onPress={() => setDeleteConfirmId(null)}>
                        <Text style={styles.deleteCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteConfirmBtn}
                        onPress={() => handleDeleteGame(game.id)}
                        disabled={deleting}
                      >
                        {deleting ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.deleteConfirmBtnText}>Delete</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    paddingTop: 56,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 14, color: Colors.textLight, marginTop: 2 },
  signOut: { color: Colors.primaryDark, fontSize: 14, marginTop: 4, textDecorationLine: 'underline' },
  inviteBox: {
    backgroundColor: Colors.surface,
    margin: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  inviteTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  inviteRow: { flexDirection: 'row', gap: 8 },
  inviteInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: RADII.md,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inviteBtn: {
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  inviteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  soloBtn: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  soloBtnText: {
    color: Colors.primaryDark,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: Colors.textLight, fontSize: 16, textAlign: 'center' },
  gameCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  gameCardActive: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  gameCardLeft: { flex: 1 },
  opponentName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  gameStatus: { fontSize: 13, color: Colors.textLight, marginTop: 2 },
  gameCardRight: {},
  gameScore: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: { flex: 1, fontSize: 13, color: '#C0392B', fontWeight: '600' },
  errorBannerDismiss: { fontSize: 15, color: '#C0392B', fontWeight: '700', paddingLeft: 8 },
  deleteConfirm: {
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    marginBottom: 10,
    marginTop: -6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  deleteConfirmText: { fontSize: 13, color: Colors.text, fontWeight: '600', marginBottom: 8 },
  deleteConfirmBtns: { flexDirection: 'row', gap: 8 },
  deleteCancelBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  deleteCancelText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  deleteConfirmBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#C0392B',
  },
  deleteConfirmBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
