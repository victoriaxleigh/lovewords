import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from './src/hooks/useAuth';
import AuthScreen from './src/screens/AuthScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import { Colors } from './src/utils/colors';
import { Player } from './src/types';
import { registerPushSubscription } from './src/utils/pushSubscription';
import { setupBadgeClearing } from './src/utils/appBadge';

const Stack = createNativeStackNavigator();

export default function App() {
  const { user, loading } = useAuth();

  // Clear the Home Screen app-icon badge whenever the app is open/foregrounded.
  useEffect(() => setupBadgeClearing(), []);

  // When user logs in, register this device for push notifications
  useEffect(() => {
    if (user?.id) {
      // Small delay so it doesn't fire the permission popup instantly on login
      const t = setTimeout(() => registerPushSubscription(user.id), 2000);
      return () => clearTimeout(t);
    }
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
