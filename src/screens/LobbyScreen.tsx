import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { createGame, createSoloGame, subscribeToUserGames, deleteGame, archiveGame, getUserGameCount } from '../supabase/gameService';
import { getUserByEmail } from '../supabase/authService';
import { getHasLifetimeAccess } from '../utils/purchases';
import { Game, GameMode, Player } from '../types';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { useNavigation } from '@react-navigation/native';
import NewGameModal from './NewGameModal';

type Props = {
  currentUser: Player;
};

type Tab = 'active' | 'past' | 'archived';

export default function LobbyScreen({ currentUser }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [showNewGame, setShowNewGame] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [startingSolo, setStartingSolo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  useEffect(() => {
    const unsub = subscribeToUserGames(currentUser.uid, (g) => {
      setGames(g);
      setLoading(false);
    });
    return unsub;
  }, [currentUser.uid]);

  // Native app only: one free game, then a $2.99 lifetime unlock. The web app
  // stays free/unlimited (Platform.OS === 'web' skips the gate entirely).
  // Only blocks *starting a new* game — existing games are never affected.
  async function isBlockedByPaywall(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    if (await getHasLifetimeAccess()) return false;
    const gameCount = await getUserGameCount(currentUser.uid);
    return gameCount >= 1;
  }

  async function handleStartSolo() {
    setStartingSolo(true);
    setErrorMsg(null);
    try {
      if (await isBlockedByPaywall()) {
        setShowNewGame(false);
        navigation.navigate('Paywall');
        return;
      }
      const gameId = await createSoloGame(currentUser);
      setShowNewGame(false);
      navigation.navigate('Game', { gameId, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setStartingSolo(false);
    }
  }

  async function handleStart(email: string, mode: GameMode) {
    if (!email.trim()) return;
    setInviting(true);
    setErrorMsg(null);
    try {
      if (await isBlockedByPaywall()) {
        setShowNewGame(false);
        navigation.navigate('Paywall');
        return;
      }
      const opponentData = await getUserByEmail(email);
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
      const gameId = await createGame(currentUser, opponent, mode);
      setShowNewGame(false);
      navigation.navigate('Game', { gameId, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleArchive(gameId: string, archived: boolean) {
    setBusyId(gameId);
    const result = await archiveGame(gameId, archived);
    setBusyId(null);
    setMenuId(null);
    if (!result.success) setErrorMsg(result.error ?? 'Could not update game.');
  }

  async function handleDeleteGame(gameId: string) {
    setBusyId(gameId);
    const result = await deleteGame(gameId);
    setBusyId(null);
    setMenuId(null);
    if (!result.success) setErrorMsg(result.error ?? 'Could not delete game.');
  }

  function isSoloGame(game: Game) {
    return game.players.some((p) => p.email === 'solo');
  }

  function statusLabel(game: Game) {
    if (game.status === 'finished') return '🏁 Finished';
    if (isSoloGame(game)) return '🎯 Solo practice';
    return game.currentTurn === currentUser.uid ? '💌 Your turn' : '⏳ Their turn';
  }

  function modeBadge(game: Game) {
    if (isSoloGame(game)) return '🎯';
    return game.mode === 'friend' ? '🎲' : '💕';
  }

  function getOpponent(game: Game) {
    return game.players.find((p) => p.uid !== currentUser.uid);
  }

  function getMyScore(game: Game) {
    return game.players.find((p) => p.uid === currentUser.uid)?.score ?? 0;
  }

  // Partition into the three tabs. Archived wins over status.
  const activeGames = games.filter((g) => !g.archived && g.status !== 'finished');
  const pastGames = games.filter((g) => !g.archived && g.status === 'finished');
  const archivedGames = games.filter((g) => g.archived);
  const tabGames = activeTab === 'active' ? activeGames : activeTab === 'past' ? pastGames : archivedGames;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: activeGames.length },
    { key: 'past', label: 'Past', count: pastGames.length },
    { key: 'archived', label: 'Archived', count: archivedGames.length },
  ];

  const emptyText =
    activeTab === 'active'
      ? 'No active games. Start a new one above! 🎲'
      : activeTab === 'past'
      ? 'No finished games yet.'
      : 'Nothing archived.';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {currentUser.displayName} 💕</Text>
          <Text style={styles.subtitle}>Your games</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
          accessibilityRole="button"
        >
          <Text style={styles.settingsBtn}>⚙️ Settings</Text>
        </TouchableOpacity>
      </View>

      {/* New game */}
      <TouchableOpacity
        style={styles.newGameBtn}
        onPress={() => {
          setErrorMsg(null);
          setShowNewGame(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Start a new game"
      >
        <Text style={styles.newGameBtnText}>➕ New Game</Text>
      </TouchableOpacity>

      {/* Inline error (for actions outside the modal, e.g. archive/delete failures) */}
      {errorMsg && !showNewGame && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
          <TouchableOpacity onPress={() => setErrorMsg(null)} accessibilityLabel="Dismiss error" accessibilityRole="button">
            <Text style={styles.errorBannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabRow}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => {
              setActiveTab(t.key);
              setMenuId(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === t.key }}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Games list */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : tabGames.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🎲</Text>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <FlatList
          data={tabGames}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item: game }) => {
            const opponent = getOpponent(game);
            const myScore = getMyScore(game);
            const isMyTurn = game.currentTurn === currentUser.uid && game.status === 'active';
            const showingMenu = menuId === game.id;
            const rowBusy = busyId === game.id;
            return (
              <View>
                <TouchableOpacity
                  style={[styles.gameCard, isMyTurn && styles.gameCardActive]}
                  onPress={() => {
                    if (showingMenu) { setMenuId(null); return; }
                    navigation.navigate('Game', { gameId: game.id, myUid: currentUser.uid, myDisplayName: currentUser.displayName });
                  }}
                  onLongPress={() => setMenuId(game.id)}
                  delayLongPress={500}
                  accessibilityHint="Long press for archive and delete options"
                >
                  <View style={styles.gameCardLeft}>
                    <Text style={styles.opponentName}>
                      <Text style={styles.modeBadge}>{modeBadge(game)} </Text>
                      vs {opponent?.displayName ?? '?'}
                    </Text>
                    <Text style={styles.gameStatus}>{statusLabel(game)}</Text>
                  </View>
                  <View style={styles.gameCardRight}>
                    <Text style={styles.gameScore}>
                      {myScore} – {opponent?.score ?? 0}
                    </Text>
                  </View>
                </TouchableOpacity>
                {showingMenu && (
                  <View style={styles.menu}>
                    <TouchableOpacity
                      style={styles.menuBtn}
                      onPress={() => handleArchive(game.id, !game.archived)}
                      disabled={rowBusy}
                    >
                      {rowBusy ? (
                        <ActivityIndicator color={Colors.primaryDark} size="small" />
                      ) : (
                        <Text style={styles.menuBtnText}>{game.archived ? '↩️ Unarchive' : '🗄️ Archive'}</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.menuBtn, styles.menuBtnDelete]}
                      onPress={() => handleDeleteGame(game.id)}
                      disabled={rowBusy}
                    >
                      <Text style={styles.menuBtnDeleteText}>🗑️ Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuId(null)} disabled={rowBusy}>
                      <Text style={styles.menuBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <NewGameModal
        visible={showNewGame}
        onClose={() => setShowNewGame(false)}
        onStart={handleStart}
        onStartSolo={handleStartSolo}
        inviting={inviting}
        startingSolo={startingSolo}
        errorMsg={errorMsg}
        onClearError={() => setErrorMsg(null)}
      />
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
  settingsBtn: { color: Colors.primaryDark, fontSize: 14, marginTop: 4, fontWeight: '600' },
  newGameBtn: {
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    borderRadius: RADII.md,
    paddingVertical: 15,
    alignItems: 'center',
    ...SHADOWS.card,
  },
  newGameBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: RADII.md,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADII.sm,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: Colors.textLight },
  tabTextActive: { color: '#fff' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: Colors.textLight, fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },
  gameCard: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.lg,
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
  modeBadge: { fontSize: 15 },
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
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: { flex: 1, fontSize: 13, color: '#C0392B', fontWeight: '600' },
  errorBannerDismiss: { fontSize: 15, color: '#C0392B', fontWeight: '700', paddingLeft: 8 },
  menu: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    marginBottom: 10,
    marginTop: -6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuBtn: {
    flex: 1,
    borderRadius: RADII.sm,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  menuBtnText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  menuBtnDelete: { backgroundColor: '#C0392B', borderColor: '#C0392B' },
  menuBtnDeleteText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
