import React, { useEffect } from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from './src/hooks/useAuth';
import AuthScreen from './src/screens/AuthScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { Colors } from './src/utils/colors';
import { Player } from './src/types';
import { registerPushSubscription } from './src/utils/pushSubscription';
import { registerForPushNotifications } from './src/utils/notifications';
import { setupBadgeClearing } from './src/utils/appBadge';
import { configurePurchases } from './src/utils/purchases';

const Stack = createNativeStackNavigator();

export default function App() {
  const { user, loading } = useAuth();

  // Clear the Home Screen app-icon badge whenever the app is open/foregrounded.
  useEffect(() => setupBadgeClearing(), []);

  // When user logs in, register this device for push notifications.
  // Web uses the Web Push/VAPID flow; native uses Expo push tokens (APNs/FCM).
  useEffect(() => {
    if (user?.id) {
      const register = Platform.OS === 'web' ? registerPushSubscription : registerForPushNotifications;
      // Small delay so it doesn't fire the permission popup instantly on login
      const t = setTimeout(() => register(user.id), 2000);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  // Configure RevenueCat (no-op on web — the web app is free/unlimited)
  useEffect(() => {
    if (user?.id) configurePurchases(user.id);
  }, [user?.id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  // Supabase stores display_name in user_metadata
  const displayName =
    user?.user_metadata?.display_name ??
    user?.email?.split('@')[0] ??
    'You';

  const currentPlayer: Player | null = user
    ? {
        uid: user.id,
        displayName,
        email: user.email ?? '',
        score: 0,
        rack: [],
      }
    : null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!user ? (
            <Stack.Screen name="Auth" component={AuthScreen} />
          ) : (
            <>
              <Stack.Screen name="Lobby">
                {() => <LobbyScreen currentUser={currentPlayer!} />}
              </Stack.Screen>
              <Stack.Screen name="Settings">
                {() => <SettingsScreen currentUser={currentPlayer!} />}
              </Stack.Screen>
              <Stack.Screen name="Paywall" component={PaywallScreen} />
              <Stack.Screen
                name="Game"
                component={GameScreen}
                initialParams={{
                  myUid: user.id,
                  myDisplayName: displayName,
                }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
