import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Tile } from '../types';
import { Colors } from '../utils/colors';

type Props = {
  tile: Tile;
  selected?: boolean;
  onPress?: () => void;
  size?: number;
  disabled?: boolean;
  isNew?: boolean; // tile placed this turn (pending, not yet submitted)
  highlight?: boolean; // tile was part of the last committed word
};

export default function TileComponent({
  tile,
  selected = false,
  onPress,
  size = 40,
  disabled = false,
  isNew = false,
  highlight = false,
}: Props) {
  const tileSize = size;
  const fontSize = size * 0.42;
  const valueFontSize = size * 0.22;

  const displayLetter = tile.letter !== '' ? tile.letter : '★';
  const label =
    tile.isBlank && tile.letter === ''
      ? 'Blank tile'
      : tile.isBlank
      ? `Blank tile set to ${tile.letter}`
      : `${tile.letter}, ${tile.value} point${tile.value === 1 ? '' : 's'}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={[
        styles.tile,
        {
          width: tileSize,
          height: tileSize,
          backgroundColor: selected
            ? Colors.tileSelected
            : isNew
            ? Colors.tilePlaced
            : Colors.tileDefault,
          borderRadius: size * 0.12,
          shadowColor: highlight ? '#FFB300' : '#000',
          shadowOpacity: highlight ? 0.9 : 0.2,
          shadowRadius: highlight ? 6 : 3,
          shadowOffset: { width: 0, height: highlight ? 0 : 2 },
          elevation: selected ? 6 : highlight ? 6 : 4,
          transform: [{ scale: selected ? 1.08 : 1 }],
          borderColor: selected ? Colors.primary : highlight ? '#FFB300' : '#E0C8D0',
          borderWidth: selected ? 2.5 : highlight ? 2 : 1,
          zIndex: selected ? 10 : 1,
        },
      ]}
    >
      <Text style={[styles.letter, tile.isBlank && tile.letter !== '' && styles.blankAssigned, { fontSize }]}>
        {displayLetter}
      </Text>
      {!tile.isBlank && (
        <Text style={[styles.value, { fontSize: valueFontSize }]}>{tile.value}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E0C8D0',
    margin: 2,
  },
  letter: {
    fontWeight: '700',
    color: Colors.tileText,
    letterSpacing: -0.5,
  },
  // Subtle italic so assigned blanks read as "this is a blank, not a real tile"
  blankAssigned: {
    fontStyle: 'italic',
  },
  value: {
    position: 'absolute',
    bottom: 2,
    right: 3,
    color: Colors.textLight,
    fontWeight: '600',
  },
});
