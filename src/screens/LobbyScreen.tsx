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
import { createGame, createSoloGame, subscribeToUserGames, deleteGame, getUserGameCount } from '../supabase/gameService';
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

type Tab = 'active' | 'past';

// Native app: number of games playable before the $2.99 lifetime unlock.
const FREE_GAME_LIMIT = 3;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

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

  // Native app only: three free games, then a $2.99 lifetime unlock. The web
  // app stays free/unlimited (Platform.OS === 'web' skips the gate entirely).
  async function isBlockedByPaywall(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    if (await getHasLifetimeAccess()) return false;
    const gameCount = await getUserGameCount(currentUser.uid);
    return gameCount >= FREE_GAME_LIMIT;
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
        setErrorMsg('No one with that email yet. Ask them to sign up first.');
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
    if (game.status === 'finished') return 'Finished';
    if (isSoloGame(game)) return 'Solo practice';
    return game.currentTurn === currentUser.uid ? 'Your turn' : 'Their turn';
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

  const activeGames = games.filter((g) => g.status !== 'finished');
  const pastGames = games.filter((g) => g.status === 'finished');
  const tabGames = activeTab === 'active' ? activeGames : pastGames;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: activeGames.length },
    { key: 'past', label: 'Past', count: pastGames.length },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(currentUser.displayName)}</Text>
          </View>
          <View>
            <Text style={styles.greeting}>Hi, {currentUser.displayName}</Text>
            <Text style={styles.subtitle}>Ready to play? 💕</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsBtn}
          accessibilityLabel="Settings"
          accessibilityRole="button"
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* New game hero */}
      <TouchableOpacity
        style={styles.newGameBtn}
        onPress={() => {
          setErrorMsg(null);
          setShowNewGame(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Start a new game"
      >
        <View>
          <Text style={styles.newGameTitle}>➕ New game</Text>
          <Text style={styles.newGameSub}>Partner 💕 or Friend 🎲</Text>
        </View>
        <Text style={styles.newGameArrow}>›</Text>
      </TouchableOpacity>

      {/* Inline error (archive/delete failures etc.) */}
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
          <Text style={styles.emptyEmoji}>{activeTab === 'active' ? '🎲' : '🏁'}</Text>
          <Text style={styles.emptyTitle}>
            {activeTab === 'active' ? 'No games going' : 'No finished games'}
          </Text>
          <Text style={styles.emptyText}>
            {activeTab === 'active'
              ? 'Tap “New game” to challenge someone.'
              : 'Games you finish will show up here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tabGames}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item: game }) => {
            const opponent = getOpponent(game);
            const myScore = getMyScore(game);
            const oppScore = opponent?.score ?? 0;
            const isMyTurn = game.currentTurn === currentUser.uid && game.status === 'active' && !isSoloGame(game);
            const showingMenu = menuId === game.id;
            const rowBusy = busyId === game.id;
            const name = opponent?.displayName ?? 'Player';
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
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSoloGame(game)
                      ? `Solo practice game, ${statusLabel(game)}, your score ${myScore}`
                      : `${game.mode === 'friend' ? 'Friend' : 'Partner'} game with ${name}, ${statusLabel(game)}, score ${myScore} to ${oppScore}`
                  }
                  accessibilityHint="Opens the game. Long press to delete it."
                >
                  <View style={styles.cardAvatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text style={styles.cardAvatarText}>{isSoloGame(game) ? '🎯' : initials(name)}</Text>
                  </View>
                  <View style={styles.gameCardLeft} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text style={styles.opponentName} numberOfLines={1}>
                      {isSoloGame(game) ? 'Solo practice' : name}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.modeBadge}>{modeBadge(game)}</Text>
                      <View style={[styles.statusChip, isMyTurn && styles.statusChipActive]}>
                        <Text style={[styles.statusChipText, isMyTurn && styles.statusChipTextActive]}>
                          {statusLabel(game)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.gameCardRight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text style={styles.gameScore}>{myScore}</Text>
                    <Text style={styles.gameScoreDivider}>vs</Text>
                    <Text style={styles.gameScoreOpp}>{oppScore}</Text>
                  </View>
                </TouchableOpacity>
                {showingMenu && (
                  <View style={styles.menu}>
                    <TouchableOpacity
                      style={[styles.menuBtn, styles.menuBtnDelete]}
                      onPress={() => handleDeleteGame(game.id)}
                      disabled={rowBusy}
                    >
                      {rowBusy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.menuBtnDeleteText}>🗑️ Delete game</Text>
                      )}
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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.btn,
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  greeting: { fontSize: 20, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textLight, marginTop: 1 },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.card,
  },
  settingsIcon: { fontSize: 18 },
  newGameBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    ...SHADOWS.btn,
  },
  newGameTitle: { color: '#fff', fontWeight: '800', fontSize: 18 },
  newGameSub: { color: '#fff', fontSize: 13, marginTop: 2 },
  newGameArrow: { color: '#fff', fontSize: 30, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: RADII.md,
    padding: 4,
    ...SHADOWS.card,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADII.sm,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '700', color: Colors.textLight },
  tabTextActive: { color: '#fff' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 50, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 52, marginBottom: 14 },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptyText: { color: Colors.textLight, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  gameCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...SHADOWS.card,
  },
  gameCardActive: {
    borderColor: Colors.primary,
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.tilePlaced,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardAvatarText: { color: Colors.primaryDark, fontWeight: '800', fontSize: 16 },
  gameCardLeft: { flex: 1 },
  opponentName: { fontSize: 16, fontWeight: '800', color: Colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  modeBadge: { fontSize: 14 },
  statusChip: {
    backgroundColor: Colors.background,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusChipActive: { backgroundColor: Colors.primary },
  statusChipText: { fontSize: 12, fontWeight: '700', color: Colors.textLight },
  statusChipTextActive: { color: '#fff' },
  gameCardRight: { alignItems: 'center', minWidth: 52 },
  gameScore: { fontSize: 22, fontWeight: '900', color: Colors.primary, lineHeight: 24 },
  gameScoreDivider: { fontSize: 10, color: Colors.textLight, fontWeight: '700' },
  gameScoreOpp: { fontSize: 16, fontWeight: '700', color: Colors.textLight, lineHeight: 18 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: { flex: 1, fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  errorBannerDismiss: { fontSize: 15, color: Colors.errorDark, fontWeight: '700', paddingLeft: 8 },
  menu: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  menuBtn: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  menuBtnText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  menuBtnDelete: { backgroundColor: Colors.errorDark, borderColor: Colors.errorDark },
  menuBtnDeleteText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
