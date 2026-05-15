import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Player } from '../types';
import { Colors } from '../utils/colors';

type Props = {
  players: [Player, Player];
  currentTurn: string;
  myUid: string;
  bagCount: number;
  isSolo?: boolean;
  currentSide?: number; // solo only: which index is currently active (0 or 1)
};

export default function ScoreBoard({ players, currentTurn, myUid, bagCount, isSolo, currentSide }: Props) {
  // In solo mode both players share the same uid, so we use array index instead
  const myIdx = isSolo ? (currentSide ?? 0) : players.findIndex((p) => p.uid === myUid);
  const me = players[myIdx];
  const them = players[1 - myIdx];
  // In solo mode currentTurn is always myUid, so use currentSide to determine who's active
  const isMyTurn = isSolo ? true : currentTurn === myUid;

  return (
    <View style={styles.container}>
      {/* Opponent */}
      <View
        style={[styles.playerCard, !isMyTurn && styles.activeCard]}
        accessibilityLabel={`${them?.displayName ?? 'Opponent'}, ${them?.score ?? 0} points${!isMyTurn ? ', their turn' : ''}`}
      >
        <Text style={styles.name} numberOfLines={1}>{them?.displayName ?? 'Them'}</Text>
        <Text style={styles.score}>{them?.score ?? 0}</Text>
        {!isMyTurn && <View style={styles.turnDot} />}
      </View>

      {/* Bag count */}
      <View style={styles.bagSection} accessibilityLabel={`${bagCount} tiles remaining in bag`}>
        <Text style={styles.bagEmoji}>🎒</Text>
        <Text style={styles.bagCount}>{bagCount}</Text>
      </View>

      {/* Me */}
      <View
        style={[styles.playerCard, isMyTurn && styles.activeCard]}
        accessibilityLabel={`${isSolo ? (me?.displayName ?? 'You') : 'You'}, ${me?.score ?? 0} points${isMyTurn ? ', your turn' : ''}`}
      >
        <Text style={styles.name} numberOfLines={1}>{isSolo ? (me?.displayName ?? 'You') : 'You'}</Text>
        <Text style={styles.score}>{me?.score ?? 0}</Text>
        {isMyTurn && <View style={styles.turnDot} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 8,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  playerCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    padding: 8,
    position: 'relative',
  },
  activeCard: {
    backgroundColor: Colors.background,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 2,
  },
  score: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
  },
  turnDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  bagSection: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  bagEmoji: {
    fontSize: 20,
  },
  bagCount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textLight,
  },
});
