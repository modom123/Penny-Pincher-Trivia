import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import AuthScreen from '../screens/AuthScreen';
import UsernamePickerScreen from '../screens/UsernamePickerScreen';
import LobbyScreen from '../screens/LobbyScreen';
import WalletScreen from '../screens/WalletScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import GameScreen from '../screens/GameScreen';
import ResultsScreen from '../screens/ResultsScreen';
import { theme } from '../theme';
import type { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, loading, needsUsername } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : needsUsername ? (
          <Stack.Screen name="Username" component={UsernamePickerScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Lobby" component={LobbyScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
            <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Top Winners' }} />
            <Stack.Screen name="Game" component={GameScreen} options={{ title: 'Live Game' }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results', headerBackVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
