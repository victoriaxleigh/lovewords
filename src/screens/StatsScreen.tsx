import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFinishedGames } from '../supabase/gameService';
import {
  computePlayerStats,
  formatAverage,
  formatRecord,
  formatWinRate,
  OpponentSummary,
  PlayerStats,
  Streak,
  WinRecord,
} from '../engine/stats';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { Player } from '../types';

type Props = {
  currentUser: Player;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function streakCopy(streak: Streak, longestWin: number): string {
  if (streak.kind === 'win' && streak.length > 1) return `On a ${streak.length}-game win streak 🔥`;
  if (streak.kind === 'win') return 'Won the last one 🏆';
  if (streak.kind === 'loss' && streak.length > 1) return `Lost the last ${streak.length} — comeback time 💪`;
  if (streak.kind === 'loss') return 'Lost the last one — shake it off 💪';
  if (streak.kind === 'tie') return 'Last game was a tie 🤝';
  return longestWin > 0 ? `Best win streak: ${longestWin}` : 'Your first game awaits 💕';
}

// Win-rate meter: the track is a lighter step of the same pink as the fill.
export function WinMeter({ record, label }: { record: WinRecord; label: string }) {
  const rate = record.winRate ?? 0;
  return (
    <View
      style={styles.meterTrack}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(rate * 100) }}
    >
      <View style={[styles.meterFill, { width: `${Math.round(rate * 100)}%` }]} />
    </View>
  );
}

export function StatTile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${meta ? `, ${meta}` : ''}`}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {meta ? (
        <Text style={styles.tileMeta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

function OpponentRow({ opponent, onPress }: { opponent: OpponentSummary; onPress: () => void }) {
  const { record } = opponent;
  return (
    <TouchableOpacity
      style={styles.opponentRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${opponent.displayName}, ${plural(record.played, 'game')}, ${record.wins} wins, ${record.losses} losses, ${record.ties} ties`}
      accessibilityHint="Opens your head-to-head stats"
    >
      <View style={styles.rowAvatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.rowAvatarText}>{initials(opponent.displayName)}</Text>
      </View>
      <View style={styles.rowBody} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.rowName} numberOfLines={1}>
          {opponent.displayName}
        </Text>
        <Text style={styles.rowMeta}>
          {plural(record.played, 'game')} · {formatWinRate(record)} win rate
        </Text>
      </View>
      <View style={styles.rowRight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.rowRecord}>{formatRecord(record)}</Text>
        <Text style={styles.rowRecordLabel}>W–L–T</Text>
      </View>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        ›
      </Text>
    </TouchableOpacity>
  );
}

export default function StatsScreen({ currentUser }: Props) {
  const navigation = useNavigation<any>();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFinishedGames(currentUser.uid)
      .then((games) => {
        if (active) setStats(computePlayerStats(games, currentUser.uid));
      })
      .catch((err) => {
        if (active) setError(err.message ?? 'Could not load your stats.');
      });
    return () => {
      active = false;
    };
  }, [currentUser.uid]);

  function renderBody() {
    if (error) {
      return (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    if (!stats) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />;
    if (stats.record.played === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji} accessibilityElementsHidden>
            📊
          </Text>
          <Text style={styles.emptyTitle}>No stats yet</Text>
          <Text style={styles.emptyText}>Finish a game with your partner or a friend and your numbers show up here 💕</Text>
        </View>
      );
    }

    const { record, me, byMode } = stats;
    const bestWord = me.bestWord;
    const longestWord = me.longestWord;
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Wins – losses – ties</Text>
          <Text style={styles.heroValue} accessibilityLabel={`${record.wins} wins, ${record.losses} losses, ${record.ties} ties`}>
            {formatRecord(record)}
          </Text>
          <WinMeter record={record} label={`Win rate ${formatWinRate(record)}`} />
          <Text style={styles.heroMeta}>
            {formatWinRate(record)} win rate · {plural(record.played, 'game')}
            {stats.longestWinStreak > 1 ? ` · best streak ${stats.longestWinStreak}` : ''}
          </Text>
          <Text style={styles.heroStreak}>{streakCopy(stats.streak, stats.longestWinStreak)}</Text>
        </View>

        <View style={styles.modeRow}>
          <View style={styles.modeChip} accessible accessibilityLabel={`Partner games: ${formatRecord(byMode.partner)}`}>
            <Text style={styles.modeChipText}>💕 Partner {formatRecord(byMode.partner)}</Text>
          </View>
          <View style={styles.modeChip} accessible accessibilityLabel={`Friend games: ${formatRecord(byMode.friend)}`}>
            <Text style={styles.modeChipText}>🎲 Friend {formatRecord(byMode.friend)}</Text>
          </View>
        </View>

        <View style={styles.tileGrid}>
          <StatTile label="Average score" value={formatAverage(me.averageScore)} meta="per game" />
          <StatTile
            label="Best game"
            value={String(me.bestGameScore)}
            meta={stats.biggestWin ? `biggest win by ${stats.biggestWin.margin}` : undefined}
          />
          <StatTile
            label="Best word"
            value={bestWord ? bestWord.word : '—'}
            meta={bestWord ? `${bestWord.score} points` : 'play a game to find out'}
          />
          <StatTile
            label="Longest word"
            value={longestWord ? longestWord.word : '—'}
            meta={longestWord ? `${longestWord.word.length} letters` : undefined}
          />
          <StatTile label="Bingos" value={String(me.bingos)} meta="all 7 tiles in one turn" />
          <StatTile
            label="Points per play"
            value={formatAverage(me.pointsPerPlay)}
            meta={plural(me.plays, 'play')}
          />
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Head to head
        </Text>
        <Text style={styles.sectionHint}>Tap a player to see your history together.</Text>
        {stats.opponents.map((opponent) => (
          <OpponentRow
            key={opponent.uid}
            opponent={opponent}
            onPress={() =>
              navigation.navigate('HeadToHead', {
                opponentUid: opponent.uid,
                opponentName: opponent.displayName,
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
        <Text style={styles.title}>Stats</Text>
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
  heroLabel: { fontSize: 12, fontWeight: '600', color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1 },
  heroValue: { fontSize: 48, fontWeight: '900', color: Colors.primary, marginVertical: 4 },
  heroMeta: { fontSize: 13, fontWeight: '600', color: Colors.textLight, marginTop: 8 },
  heroStreak: { fontSize: 14, fontWeight: '700', color: Colors.primaryDark, marginTop: 6, textAlign: 'center' },
  meterTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.tilePlaced,
    overflow: 'hidden',
    marginTop: 8,
  },
  meterFill: { height: '100%', borderRadius: 5, backgroundColor: Colors.primary },

  modeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modeChip: {
    flex: 1,
    backgroundColor: Colors.tilePlaced,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  modeChipText: { fontSize: 13, fontWeight: '700', color: Colors.primaryDark },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  tile: {
    flexBasis: '45%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    paddingVertical: 14,
    paddingHorizontal: 14,
    ...SHADOWS.card,
  },
  tileLabel: { fontSize: 12, fontWeight: '600', color: Colors.textLight },
  tileValue: { fontSize: 28, fontWeight: '800', color: Colors.text, marginTop: 2 },
  tileMeta: { fontSize: 12, fontWeight: '600', color: Colors.textLight, marginTop: 2 },

  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.primaryDark, marginTop: 24 },
  sectionHint: { fontSize: 13, fontStyle: 'italic', color: Colors.textLight, marginTop: 2, marginBottom: 12 },
  opponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: RADII.lg,
    padding: 14,
    marginBottom: 12,
    ...SHADOWS.card,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.tilePlaced,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowAvatarText: { fontSize: 16, fontWeight: '800', color: Colors.primaryDark },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '800', color: Colors.text },
  rowMeta: { fontSize: 12, fontWeight: '600', color: Colors.textLight, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', marginLeft: 8 },
  rowRecord: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  rowRecordLabel: { fontSize: 12, fontWeight: '600', color: Colors.textLight, letterSpacing: 1 },
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
