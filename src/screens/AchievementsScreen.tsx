import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFinishedGames } from '../supabase/gameService';
import { Achievement, ACHIEVEMENT_COUNT, computeAchievements } from '../engine/achievements';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { Player } from '../types';

type Props = {
  currentUser: Player;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// The single place badge art is rendered, so pixel-art icons can replace the
// emoji later without touching the rest of the screen.
function BadgeIcon({ achievement }: { achievement: Achievement }) {
  return (
    <Text style={[styles.badgeEmoji, !achievement.unlocked && styles.lockedEmoji]}>
      {achievement.emoji}
    </Text>
  );
}

function BadgeCard({ achievement }: { achievement: Achievement }) {
  const { unlocked, progress } = achievement;
  const showProgress = !unlocked && progress !== undefined;
  const label = unlocked
    ? `${achievement.title}, unlocked${achievement.unlockedAt ? ` ${formatDate(achievement.unlockedAt)}` : ''}`
    : `${achievement.title}, locked. ${achievement.description}${
        showProgress ? ` ${progress.current} of ${progress.target}.` : ''
      }`;
  return (
    <View style={[styles.card, !unlocked && styles.cardLocked]} accessible accessibilityLabel={label}>
      <BadgeIcon achievement={achievement} />
      <Text style={styles.badgeTitle} numberOfLines={1}>
        {achievement.title}
      </Text>
      {unlocked ? (
        achievement.unlockedAt !== undefined && (
          <Text style={styles.badgeMeta}>{formatDate(achievement.unlockedAt)}</Text>
        )
      ) : (
        <>
          <Text style={styles.badgeDescription}>{achievement.description}</Text>
          {showProgress && (
            <Text style={styles.badgeProgress}>
              {progress.current} / {progress.target}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

export default function AchievementsScreen({ currentUser }: Props) {
  const navigation = useNavigation<any>();
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFinishedGames(currentUser.uid)
      .then((games) => {
        if (active) setAchievements(computeAchievements(games, currentUser.uid));
      })
      .catch((err) => {
        if (active) setError(err.message ?? 'Could not load achievements.');
      });
    return () => {
      active = false;
    };
  }, [currentUser.uid]);

  const unlockedCount = achievements?.filter((achievement) => achievement.unlocked).length ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" accessibilityRole="button">
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Achievements</Text>
        <View style={styles.headerSpacer} />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !achievements ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList<Achievement | null>
          // Pad an odd count with a spacer so the last badge keeps its column width.
          data={achievements.length % 2 ? [...achievements, null] : achievements}
          keyExtractor={(achievement) => achievement?.id ?? 'spacer'}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.summary} accessibilityRole="header">
              {unlockedCount} of {ACHIEVEMENT_COUNT} unlocked
            </Text>
          }
          renderItem={({ item }) =>
            item ? <BadgeCard achievement={item} /> : <View style={styles.spacer} />
          }
        />
      )}
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
  summary: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primaryDark,
    textAlign: 'center',
    marginBottom: 12,
  },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: RADII.xl,
    paddingVertical: 16,
    paddingHorizontal: 10,
    ...SHADOWS.card,
  },
  spacer: { flex: 1 },
  cardLocked: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  badgeEmoji: { fontSize: 36, marginBottom: 6 },
  lockedEmoji: { opacity: 0.35 },
  badgeTitle: { fontSize: 15, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  badgeMeta: { fontSize: 12, color: Colors.textLight, marginTop: 4 },
  badgeDescription: {
    fontSize: 12,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
  badgeProgress: { fontSize: 13, fontWeight: '700', color: Colors.primaryDark, marginTop: 6 },
  errorBanner: {
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
});
