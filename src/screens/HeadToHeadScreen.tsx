import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getFinishedGames } from '../supabase/gameService';
import {
  computeHeadToHead,
  formatAverage,
  GameSummary,
  HeadToHeadStats,
  SeatStats,
} from '../engine/stats';
import { Colors } from '../utils/colors';
import { shortName } from '../utils/displayName';
import { RADII, SHADOWS } from '../utils/styles';
import { GameMode, Player } from '../types';

type Props = {
  currentUser: Player;
};

type RouteParams = {
  opponentUid: string;
  opponentName?: string;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function headToHeadStreakCopy(stats: HeadToHeadStats): string {
  const name = shortName(stats.opponent.displayName);
  const { kind, length } = stats.streak;
  const tease = stats.mode === 'friend';
  if (kind === 'win') {
    return length > 1
      ? `You've won the last ${length} ${tease ? '😎' : '🔥'}`
      : `You won the last one ${tease ? '😏' : '🏆'}`;
  }
  if (kind === 'loss') {
    return length > 1
      ? `${name} has won the last ${length} ${tease ? '👀' : '💪'}`
      : `${name} won the last one ${tease ? '👀' : '💪'}`;
  }
  return `Last one was a tie ${tease ? '🤝' : '💕'}`;
}

function subtitleFor(mode: GameMode) {
  return mode === 'friend' ? 'The rivalry so far 🎲' : 'Your love story in numbers 💕';
}

const RESULT_LABEL: Record<GameSummary['result'], string> = { win: 'Won', loss: 'Lost', tie: 'Tie' };

type CompareRow = {
  label: string;
  me: string;
  them: string;
  // Second line under each value (a word's score or length).
  meMeta?: string;
  themMeta?: string;
  // Who leads on this row, for the bold highlight. Null when level or empty.
  leader: 'me' | 'them' | null;
};

function compareNumbers(label: string, mine: number | null, theirs: number | null, format: (value: number | null) => string): CompareRow {
  const leader =
    mine === null || theirs === null || mine === theirs ? null : mine > theirs ? 'me' : 'them';
  return { label, me: format(mine), them: format(theirs), leader };
}

export function compareRows(me: SeatStats, them: SeatStats): CompareRow[] {
  const whole = (value: number | null) => (value === null ? '—' : String(value));
  const points = (count: number) => `${count} pt${count === 1 ? '' : 's'}`;
  const letters = (count: number) => `${count} letter${count === 1 ? '' : 's'}`;
  return [
    compareNumbers('Average score', me.averageScore, them.averageScore, formatAverage),
    compareNumbers('Best game', me.bestGameScore, them.bestGameScore, whole),
    {
      label: 'Best word',
      me: me.bestWord?.word ?? '—',
      them: them.bestWord?.word ?? '—',
      meMeta: me.bestWord ? points(me.bestWord.score) : undefined,
      themMeta: them.bestWord ? points(them.bestWord.score) : undefined,
      leader: compareNumbers('', me.bestWord?.score ?? null, them.bestWord?.score ?? null, whole).leader,
    },
    {
      label: 'Longest word',
      me: me.longestWord?.word ?? '—',
      them: them.longestWord?.word ?? '—',
      meMeta: me.longestWord ? letters(me.longestWord.word.length) : undefined,
      themMeta: them.longestWord ? letters(them.longestWord.word.length) : undefined,
      leader: compareNumbers(
        '',
        me.longestWord?.word.length ?? null,
        them.longestWord?.word.length ?? null,
        whole
      ).leader,
    },
    compareNumbers('Bingos', me.bingos, them.bingos, whole),
    compareNumbers('Points per play', me.pointsPerPlay, them.pointsPerPlay, formatAverage),
  ];
}

function GameRow({ summary, onPress }: { summary: GameSummary; onPress: () => void }) {
  const result = summary.result;
  return (
    <TouchableOpacity
      style={styles.gameRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${formatDate(summary.finishedAt)}, ${summary.mode === 'friend' ? 'friend' : 'partner'} game, ${RESULT_LABEL[result].toLowerCase()} ${summary.myScore} to ${summary.theirScore}`}
      accessibilityHint="Opens the finished game"
    >
      <Text style={styles.gameMode} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {summary.mode === 'friend' ? '🎲' : '💕'}
      </Text>
      <View style={styles.gameBody} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.gameScore}>
          {summary.myScore} – {summary.theirScore}
        </Text>
        <Text style={styles.gameDate}>{formatDate(summary.finishedAt)}</Text>
      </View>
      <View
        style={[styles.resultChip, result === 'win' && styles.resultChipWin, result === 'tie' && styles.resultChipTie]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={[styles.resultChipText, result === 'win' && styles.resultChipTextWin, result === 'tie' && styles.resultChipTextTie]}
        >
          {RESULT_LABEL[result]}
        </Text>
      </View>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        ›
      </Text>
    </TouchableOpacity>
  );
}

export default function HeadToHeadScreen({ currentUser }: Props) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { opponentUid, opponentName } = route.params as RouteParams;
  const [stats, setStats] = useState<HeadToHeadStats | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFinishedGames(currentUser.uid)
      .then((games) => {
        if (active) setStats(computeHeadToHead(games, currentUser.uid, opponentUid));
      })
      .catch((err) => {
        if (active) setError(err.message ?? 'Could not load these stats.');
      });
    return () => {
      active = false;
    };
  }, [currentUser.uid, opponentUid]);

  const fullName = stats?.opponent.displayName ?? opponentName ?? 'Player';
  const name = shortName(fullName) || 'Player';

  function renderBody() {
    if (error) {
      return (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    if (stats === undefined) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />;
    if (stats === null) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji} accessibilityElementsHidden>
            📊
          </Text>
          <Text style={styles.emptyTitle}>Nothing to compare yet</Text>
          <Text style={styles.emptyText}>Finish a game with {name} and the scoreboard shows up here 💕</Text>
        </View>
      );
    }

    const { record } = stats;
    const decided = record.wins + record.losses;
    const myShare = decided === 0 ? 50 : Math.round((record.wins / decided) * 100);
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroSubtitle}>{subtitleFor(stats.mode)}</Text>
          <View
            style={styles.versus}
            accessible
            accessibilityLabel={`You ${record.wins} wins, ${fullName} ${record.losses} wins, ${record.ties} ties`}
          >
            <View style={styles.versusSide}>
              <Text style={styles.versusName} numberOfLines={1}>
                You
              </Text>
              <Text style={styles.versusWins}>{record.wins}</Text>
            </View>
            <View style={styles.versusMiddle}>
              <Text style={styles.versusTies}>{record.ties}</Text>
              <Text style={styles.versusTiesLabel}>{record.ties === 1 ? 'tie' : 'ties'}</Text>
            </View>
            <View style={styles.versusSide}>
              <Text style={styles.versusName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.versusWins}>{record.losses}</Text>
            </View>
          </View>
          <View
            style={styles.splitTrack}
            accessibilityRole="progressbar"
            accessibilityLabel={`You have won ${myShare}% of decided games`}
            accessibilityValue={{ min: 0, max: 100, now: myShare }}
          >
            <View style={[styles.splitFill, { width: `${myShare}%` }]} />
          </View>
          <Text style={styles.heroMeta}>
            {record.played} {record.played === 1 ? 'game' : 'games'} together
          </Text>
          <Text style={styles.heroStreak}>{headToHeadStreakCopy(stats)}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableLabel]} />
            <Text style={[styles.tableCell, styles.tableHeading]}>You</Text>
            <Text style={[styles.tableCell, styles.tableHeading]} numberOfLines={1}>
              {name}
            </Text>
          </View>
          {compareRows(stats.me, stats.them).map((row) => (
            <View
              key={row.label}
              style={styles.tableRow}
              accessible
              accessibilityLabel={`${row.label}: you ${row.me}${row.meMeta ? ` (${row.meMeta})` : ''}, ${fullName} ${row.them}${row.themMeta ? ` (${row.themMeta})` : ''}`}
            >
              <Text style={[styles.tableCell, styles.tableLabel]}>{row.label}</Text>
              <View style={styles.tableCell}>
                <Text style={[styles.tableValue, row.leader === 'me' && styles.tableLead]}>{row.me}</Text>
                {row.meMeta ? <Text style={styles.tableMeta}>{row.meMeta}</Text> : null}
              </View>
              <View style={styles.tableCell}>
                <Text style={[styles.tableValue, row.leader === 'them' && styles.tableLead]}>{row.them}</Text>
                {row.themMeta ? <Text style={styles.tableMeta}>{row.themMeta}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {(stats.biggestWin || stats.biggestLoss) && (
          <View style={styles.marginRow}>
            {stats.biggestWin && (
              <Text style={styles.marginText}>
                🏆 Biggest win: by {stats.biggestWin.margin} ({stats.biggestWin.myScore}–{stats.biggestWin.theirScore})
              </Text>
            )}
            {stats.biggestLoss && (
              <Text style={styles.marginText}>
                😬 Biggest loss: by {-stats.biggestLoss.margin} ({stats.biggestLoss.myScore}–{stats.biggestLoss.theirScore})
              </Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Games together
        </Text>
        {stats.games.map((summary) => (
          <GameRow
            key={summary.gameId}
            summary={summary}
            onPress={() =>
              navigation.navigate('Game', {
                gameId: summary.gameId,
                myUid: currentUser.uid,
                myDisplayName: currentUser.displayName,
              })
            }
          />
        ))}
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" accessibilityRole="button">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Head to head</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>{renderBody()}</ScrollView>
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
  content: { paddingHorizontal: 16, paddingBottom: 32, maxWidth: 560, width: '100%', alignSelf: 'center' },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    padding: 20,
    alignItems: 'center',
    ...SHADOWS.card,
  },
  heroSubtitle: { fontSize: 13, fontStyle: 'italic', fontWeight: '600', color: Colors.textLight },
  versus: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', marginTop: 8 },
  versusSide: { flex: 1, alignItems: 'center' },
  versusName: { fontSize: 13, fontWeight: '700', color: Colors.textLight, maxWidth: '100%' },
  versusWins: { fontSize: 48, fontWeight: '900', color: Colors.primary },
  versusMiddle: { alignItems: 'center', paddingBottom: 10, paddingHorizontal: 8 },
  versusTies: { fontSize: 20, fontWeight: '800', color: Colors.text },
  versusTiesLabel: { fontSize: 12, fontWeight: '600', color: Colors.textLight },
  splitTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.tilePlaced,
    overflow: 'hidden',
    marginTop: 4,
  },
  splitFill: { height: '100%', borderRadius: 5, backgroundColor: Colors.primary },
  heroMeta: { fontSize: 13, fontWeight: '600', color: Colors.textLight, marginTop: 8 },
  heroStreak: { fontSize: 14, fontWeight: '700', color: Colors.primaryDark, marginTop: 6, textAlign: 'center' },

  table: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: 12,
    ...SHADOWS.card,
  },
  tableHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  tableCell: { flex: 1 },
  tableLabel: { flex: 1.3, fontSize: 13, fontWeight: '600', color: Colors.textLight },
  tableHeading: { fontSize: 12, fontWeight: '700', color: Colors.primaryDark, textAlign: 'center' },
  tableValue: { fontSize: 14, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  tableLead: { color: Colors.primary, fontWeight: '800' },
  tableMeta: { fontSize: 12, fontWeight: '600', color: Colors.textLight, textAlign: 'center', marginTop: 1 },

  marginRow: { marginTop: 12, gap: 4 },
  marginText: { fontSize: 13, fontWeight: '600', color: Colors.textLight },

  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.primaryDark, marginTop: 24, marginBottom: 12 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: RADII.lg,
    padding: 14,
    marginBottom: 12,
    ...SHADOWS.card,
  },
  gameMode: { fontSize: 20, marginRight: 12 },
  gameBody: { flex: 1 },
  gameScore: { fontSize: 18, fontWeight: '800', color: Colors.text },
  gameDate: { fontSize: 12, fontWeight: '600', color: Colors.textLight, marginTop: 2 },
  resultChip: { borderRadius: 20, paddingVertical: 4, paddingHorizontal: 12, backgroundColor: Colors.background },
  resultChipWin: { backgroundColor: Colors.primary },
  resultChipTie: { backgroundColor: Colors.tilePlaced },
  resultChipText: { fontSize: 12, fontWeight: '700', color: Colors.textLight },
  resultChipTextWin: { color: Colors.surface },
  resultChipTextTie: { color: Colors.primaryDark },
  chevron: { fontSize: 22, color: Colors.textLight, marginLeft: 10 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20 },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 6 },
  emptyText: { fontSize: 14, fontStyle: 'italic', color: Colors.textLight, textAlign: 'center', lineHeight: 20 },

  errorBanner: {
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
});
