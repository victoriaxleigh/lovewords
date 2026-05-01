import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Board, PlacedTile, Tile } from '../types';
import { BOARD_SIZE } from '../engine/board';
import { Colors } from '../utils/colors';
import TileComponent from './TileComponent';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CELL_SIZE = Math.floor((SCREEN_WIDTH - 8) / BOARD_SIZE);

type Props = {
  board: Board;
  pendingTiles: PlacedTile[];
  selectedTile: Tile | null;
  onCellPress: (row: number, col: number) => void;
  onTilePress?: (tile: PlacedTile) => void;
  isMyTurn: boolean;
};

const BONUS_LABELS: Record<string, string> = {
  TW: 'TW',
  DW: 'DW',
  TL: 'TL',
  DL: 'DL',
  START: '★',
};

const BONUS_BG: Record<string, string> = {
  TW: Colors.tw,
  DW: Colors.dw,
  TL: Colors.tl,
  DL: Colors.dl,
  START: Colors.start,
};

export default function BoardComponent({
  board,
  pendingTiles,
  selectedTile,
  onCellPress,
  onTilePress,
  isMyTurn,
}: Props) {
  const pendingMap = new Map(pendingTiles.map((t) => [`${t.row},${t.col}`, t]));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.board}>
          {board.map((rowCells, row) => (
            <View key={row} style={styles.row}>
              {rowCells.map((cell, col) => {
                const pending = pendingMap.get(`${row},${col}`);
                const hasTile = cell.tile !== null || pending !== undefined;
                const bonusBg = cell.bonus ? BONUS_BG[cell.bonus] : Colors.emptyCell;
                const canPlace = isMyTurn && selectedTile && !hasTile;

                return (
                  <TouchableOpacity
                    key={col}
                    onPress={() => onCellPress(row, col)}
                    disabled={!canPlace && !pending}
                    activeOpacity={0.7}
                    style={[
                      styles.cell,
                      {
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        backgroundColor: hasTile ? 'transparent' : bonusBg,
                        borderColor: hasTile ? '#333' : '#3D1A28',
                      },
                    ]}
                  >
                    {pending ? (
                      <TileComponent
                        tile={pending}
                        size={CELL_SIZE - 2}
                        isNew
                        onPress={() => onTilePress?.(pending)}
                      />
                    ) : cell.tile ? (
                      <TileComponent tile={cell.tile} size={CELL_SIZE - 2} disabled />
                    ) : cell.bonus ? (
                      <Text style={[styles.bonusText, { fontSize: CELL_SIZE * 0.22 }]}>
                        {BONUS_LABELS[cell.bonus]}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  board: {
    backgroundColor: Colors.boardBg,
    padding: 2,
    borderRadius: 6,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusText: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
  },
});
