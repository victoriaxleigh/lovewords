import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { purchaseLifetime, restorePurchases } from '../utils/purchases';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';

export default function PaywallScreen() {
  const navigation = useNavigation<any>();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePurchase() {
    setPurchasing(true);
    setError(null);
    const result = await purchaseLifetime();
    setPurchasing(false);
    if (result.success) {
      navigation.navigate('Lobby');
    } else if (result.error) {
      setError(result.error);
    }
    // no error + !success means the user cancelled the purchase sheet — stay put, no message needed
  }

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    const restored = await restorePurchases();
    setRestoring(false);
    if (restored) {
      navigation.navigate('Lobby');
    } else {
      setError('No previous purchase found for this account.');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>💌</Text>
      <Text style={styles.title}>You've played your free game!</Text>
      <Text style={styles.body}>
        Unlock LoveWords for life — no ads, unlimited games, one-time payment.
      </Text>
      <Text style={styles.price}>$2.99 · once, forever</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.buyBtn} onPress={handlePurchase} disabled={purchasing || restoring}>
        {purchasing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buyBtnText}>Unlock for $2.99</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleRestore} disabled={purchasing || restoring}>
        {restoring ? (
          <ActivityIndicator color={Colors.primaryDark} />
        ) : (
          <Text style={styles.restoreText}>Restore Purchases</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Lobby')} disabled={purchasing || restoring}>
        <Text style={styles.laterText}>Maybe later</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, color: Colors.textLight, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  price: { fontSize: 18, fontWeight: '800', color: Colors.primary, marginBottom: 28 },
  errorBanner: {
    width: '100%',
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorText: { fontSize: 13, color: '#C0392B', fontWeight: '600', textAlign: 'center' },
  buyBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
    ...SHADOWS.btn,
  },
  buyBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  restoreText: { color: Colors.primaryDark, fontSize: 14, fontWeight: '600', marginBottom: 16 },
  laterText: { color: Colors.textLight, fontSize: 14, textDecorationLine: 'underline' },
});
