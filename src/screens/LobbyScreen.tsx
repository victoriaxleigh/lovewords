import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { createGame, subscribeToUserGames } from '../supabase/gameService';
import { logout, getUserByEmail } from '../supabase/authService';
import { Game, Player } from '../types';
import { Colors } from '../utils/colors';
import { useNavigation } from '@react-navigation/native';

type Props = {
  currentUser: Player;
};

export default function LobbyScreen({ currentUser }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const navigation = useNavigation<any>();

  useEffect(() => {
    const unsub = subscribeToUserGames(currentUser.uid, (g) => {
      setGames(g);
      setLoading(false);
    });
    return unsub;
  }, [currentUser.uid]);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const opponentData = await getUserByEmail(inviteEmail);
      if (!opponentData) {
        Alert.alert('Not found', 'No user with that email exists. Ask them to sign up!');
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
      Alert.alert('Error', err.message);
    } finally {
      setInviting(false);
    }
  }

  function statusLabel(game: Game) {
    if (game.status === 'finished') return '🏁 Finished';
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
        <TouchableOpacity onPress={logout}>
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
            return (
              <TouchableOpacity
                style={[styles.gameCard, isMyTurn && styles.gameCardActive]}
                onPress={() => navigation.navigate('Game', { gameId: game.id, myUid: currentUser.uid, myDisplayName: currentUser.displayName })}
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
  signOut: { color: Colors.primary, fontSize: 14, marginTop: 4, textDecorationLine: 'underline' },
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
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inviteBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  inviteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
});
