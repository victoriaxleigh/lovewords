import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from './src/hooks/useAuth';
import AuthScreen from './src/screens/AuthScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AchievementsScreen from './src/screens/AchievementsScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import RecoveryScreen from './src/screens/RecoveryScreen';
import { Colors } from './src/utils/colors';
import { Player } from './src/types';
import { registerPushSubscription } from './src/utils/pushSubscription';
import { registerForPushNotifications } from './src/utils/notifications';
import { setupBadgeClearing } from './src/utils/appBadge';
import { configurePurchases } from './src/utils/purchases';
import { redeemEmailInvite } from './src/supabase/gameService';
import { readPendingInvite, clearPendingInvite, stashPendingInvite } from './src/utils/pendingInvite';
import { getInviteCodeFromLocation } from './src/utils/invites';
import { onPasswordRecovery } from './src/supabase/authService';
import { clearAuthRedirectFromUrl, getLaunchAuthRedirect } from './src/utils/passwordRecovery';
import { clearRecoveryPending, isRecoveryPending, markRecoveryPending } from './src/utils/pendingRecovery';

const Stack = createNativeStackNavigator();

type RecoveryState = 'checking' | 'active' | 'inactive';
type AuthNotice = { message: string; kind: 'info' | 'error'; email?: string };

export default function App() {
  const { user: sessionUser, loading } = useAuth();

  // Password recovery. A recovery link signs the user in without giving them a
  // password, so while it's active the session is withheld from the rest of the
  // app and only RecoveryScreen renders. 'checking' covers the async read of the
  // persisted flag (a reset abandoned mid-way on an earlier launch).
  const launchRedirect = getLaunchAuthRedirect();
  const [recovery, setRecovery] = useState<RecoveryState>(
    launchRedirect.recovery ? 'active' : 'checking'
  );
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(
    launchRedirect.error ? { message: launchRedirect.error, kind: 'error' } : null
  );

  useEffect(() => {
    if (launchRedirect.recovery) {
      void markRecoveryPending();
      return;
    }
    // An expired/used link redirects back with error params Supabase leaves in
    // the URL — they're shown on AuthScreen via authNotice, so strip them.
    if (launchRedirect.error) clearAuthRedirectFromUrl();
    let cancelled = false;
    isRecoveryPending().then((pending) => {
      if (!cancelled) setRecovery((prev) => (prev === 'active' || pending ? 'active' : 'inactive'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onPasswordRecovery(() => {
        void markRecoveryPending();
        setRecovery('active');
      }),
    []
  );

  async function finishRecovery(result: { updated: boolean; email: string | null }) {
    await clearRecoveryPending();
    clearAuthRedirectFromUrl();
    setAuthNotice(
      result.updated
        ? {
            message: 'Password updated. Sign in with your new password.',
            kind: 'info',
            email: result.email ?? undefined,
          }
        : null
    );
    setRecovery('inactive');
  }

  // Everything below treats the user as signed out until recovery is resolved.
  const user = recovery === 'inactive' ? sessionUser : null;

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

  // Capture an invite link (?invite=CODE) at the app root — before auth — so it
  // works whether or not a session already exists (a logged-in user opening the
  // link never mounts AuthScreen). Stash it, then strip it from the URL so it
  // isn't re-processed or shared onward.
  useEffect(() => {
    const code = getInviteCodeFromLocation();
    if (!code) return;
    void stashPendingInvite(code);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('invite');
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Non-standard URL — leaving it is harmless.
      }
    }
  }, []);

  // Redeem a stashed invite once we have a session. The new game shows up in the
  // Lobby via the realtime subscription, so there's nothing to navigate to here.
  // Only clear the stashed code on a confirmed outcome ('created' or a
  // definitive 'gone'); a transient/network error keeps it for the next launch.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const code = await readPendingInvite();
      if (!code || cancelled) return;
      try {
        const result = await redeemEmailInvite(code);
        if (!cancelled && (result.status === 'created' || result.status === 'gone')) {
          await clearPendingInvite();
        }
      } catch {
        // Transient failure (offline, server error) — keep the code and retry later.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (recovery === 'active') {
    return <RecoveryScreen onFinished={finishRecovery} />;
  }

  if (loading || recovery === 'checking') {
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
            <Stack.Screen name="Auth">
              {() => <AuthScreen notice={authNotice} onDismissNotice={() => setAuthNotice(null)} />}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen name="Lobby">
                {() => <LobbyScreen currentUser={currentPlayer!} />}
              </Stack.Screen>
              <Stack.Screen name="Settings">
                {() => <SettingsScreen currentUser={currentPlayer!} />}
              </Stack.Screen>
              <Stack.Screen name="Achievements">
                {() => <AchievementsScreen currentUser={currentPlayer!} />}
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
