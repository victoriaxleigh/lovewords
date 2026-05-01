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
  isNew?: boolean; // tile placed this turn
};

export default function TileComponent({
  tile,
  selected = false,
  onPress,
  size = 40,
  disabled = false,
  isNew = false,
}: Props) {
  const tileSize = size;
  const fontSize = size * 0.42;
  const valueFontSize = size * 0.22;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
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
          shadowColor: selected ? Colors.primary : '#000',
          shadowOpacity: selected ? 0.5 : 0.25,
          transform: [{ scale: selected ? 1.08 : 1 }],
        },
      ]}
    >
      <Text style={[styles.letter, { fontSize }]}>
        {tile.isBlank ? '★' : tile.letter}
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
  value: {
    position: 'absolute',
    bottom: 2,
    right: 3,
    color: Colors.textLight,
    fontWeight: '600',
  },
});
