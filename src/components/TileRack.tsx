import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Tile } from '../types';
import TileComponent from './TileComponent';
import { Colors } from '../utils/colors';

type Props = {
  tiles: Tile[];
  selectedTileId: string | null;
  onTilePress: (tile: Tile) => void;
  disabled?: boolean;
};

export default function TileRack({ tiles, selectedTileId, onTilePress, disabled }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.rack}>
        {tiles.map((tile) => (
          <TileComponent
            key={tile.id}
            tile={tile}
            selected={tile.id === selectedTileId}
            onPress={() => onTilePress(tile)}
            size={46}
            disabled={disabled}
          />
        ))}
        {/* Placeholder slots */}
        {Array.from({ length: Math.max(0, 7 - tiles.length) }).map((_, i) => (
          <View key={`empty-${i}`} style={styles.emptySlot} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  rack: {
    flexDirection: 'row',
    backgroundColor: '#5C2A3E',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 6,
  },
  emptySlot: {
    width: 46,
    height: 46,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    margin: 2,
  },
});
